const express = require('express');
const http = require('http');
const app = express();
const cors = require('cors');
require('dotenv').config();

const { Server } = require('socket.io');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  SYSTEM_PROMPT,
  buildUserPrompt,
  RESPONSE_SCHEMA,
  SUPPORTED_CATEGORIES,
} = require('./prompts/legal-analyzer');

let aiModel = null;
if (process.env.GEMINI_API_KEY) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    aiModel = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });
  } catch (err) {
    console.error('Failed to initialize Gemini model:', err.message);
  }
}

const { validateBody, validateQuery, validateParams } = require('./middlewares/validate');
const {
  lawyerProfileSchema,
  lawyerEmailQuerySchema,
  lawyerEmailParamSchema,
  lawyerUserIdParamSchema,
  lawyerAllQuerySchema,
  paymentConfirmSchema,
  hiringRequestSchema,
  hiringEmailParamSchema,
  hiringStatusBodySchema,
  hiringIdParamSchema,
  userEmailParamSchema,
  userUpsertBodySchema,
  userUpdateProfileSchema,
  commentCreateSchema,
  commentIdParamSchema,
  userCommentsQuerySchema,
  commentUpdateBodySchema,
  commentDeleteQuerySchema,
  hiringsCheckQuerySchema,
  analyzeIssueSchema,
  userIdParamSchema,
  userRoleBodySchema,
  messageCreateSchema,
  messageHiringIdParamSchema,
  messageIdParamSchema,
  messageReadBodySchema,
  availabilityBodySchema,
  availabilityQuerySchema,
  bookingCreateSchema,
  bookingQuerySchema,
  bookingIdParamSchema,
  bookingStatusBodySchema,
  caseCreateSchema,
  caseIdParamSchema,
  caseUserIdParamSchema,
  caseUserQuerySchema,
  caseNoteSchema,
  caseStatusBodySchema,
} = require('./validations/schemas');

// Default legal-case milestone track shared by the case API.
const CASE_STAGE_TITLES = ["Consultation", "Evidence Gathering", "Filing", "Hearing", "Verdict"];
const CASE_STAGE_KEYS = ["consultation", "evidence_gathering", "filing", "hearing", "verdict"];

const port = process.env.PORT || 5000;
const server = http.createServer(app);

// Socket.io — real-time client-lawyer messaging
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  // Polling first lets connections survive short-lived serverless
  // invocations on Vercel; websocket upgrade is used on persistent hosts.
  transports: ["polling", "websocket"],
  pingInterval: 25000,
  pingTimeout: 20000,
  upgradeTimeout: 10000,
});

// Allowed frontend origins (local dev + production Vercel deployment)
const allowedOrigins = [
  "http://localhost:3000",
  "https://legal-ease-two-silk.vercel.app",
  process.env.CLIENT_URL,
].filter(Boolean);

// Middleware
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json()); 

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = process.env.MONGO_DB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    const database = client.db("legalease_db");
    
    
    const lawyerCollection = database.collection("lawyers");
    const hiringCollection = database.collection("hirings");
    const transactionCollection = database.collection("transactions"); 
    const usersCollection = database.collection("users");
    const commentsCollection = database.collection("comments");
    const messagesCollection = database.collection("messages");
    const availabilityCollection = database.collection("availability");
    const bookingsCollection = database.collection("bookings");
    const casesCollection = database.collection("cases");
    
    app.get('/', (req, res) => {
      res.send('LegalEase Server is Running Perfectly!');
    });

    const logger =(req, res, next) =>{
      next();
    }

    const verifyToken = ( req, res, next)=>{
      next();
    }

    /**
     * Multi-party case tracking helpers.
     */
    function buildCaseTimeline(activeIndex = 0) {
      return CASE_STAGE_TITLES.map((title, index) => ({
        key: CASE_STAGE_KEYS[index],
        title,
        status: index < activeIndex ? "completed" : index === activeIndex ? "active" : "pending",
        date: index <= activeIndex ? new Date() : null,
        notes: [],
      }));
    }

    // Re-derives milestone states after the active stage index changes.
    function recomputeTimeline(timeline, activeIndex, stageDate) {
      const fallbackDate = stageDate ? new Date(stageDate) : new Date();
      return timeline.map((milestone, index) => {
        let status = "pending";
        if (index < activeIndex) status = "completed";
        else if (index === activeIndex) status = "active";
        return {
          ...milestone,
          status,
          date: index <= activeIndex ? (milestone.date || fallbackDate) : milestone.date,
        };
      });
    }

    async function resolveUserIdByEmail(email) {
      if (!email) return null;
      try {
        const profile = await usersCollection.findOne({ email });
        return profile ? profile._id.toString() : null;
      } catch (err) {
        console.error("resolveUserIdByEmail error:", err.message);
        return null;
      }
    }

    async function createCaseRecord(payload) {
      const timeline = buildCaseTimeline(0);
      const now = new Date();
      const caseDoc = {
        hiringId: payload.hiringId,
        title: payload.title,
        clientUserId: payload.clientUserId || null,
        clientEmail: payload.clientEmail,
        clientName: payload.clientName || "",
        lawyerUserId: payload.lawyerUserId || null,
        lawyerEmail: payload.lawyerEmail || "",
        lawyerName: payload.lawyerName || "",
        specialization: payload.specialization || "",
        status: "active",
        currentStageIndex: 0,
        currentStage: CASE_STAGE_KEYS[0],
        currentStageLabel: CASE_STAGE_TITLES[0],
        timeline,
        progressNotes: [],
        createdAt: now,
        updatedAt: now,
      };
      const result = await casesCollection.insertOne(caseDoc);
      return { ...caseDoc, _id: result.insertedId };
    }

    /**
     * =================================================================
     * LAWYER PROFILE & SERVICE MANAGEMENT ROUTES (CRUD)
     * =================================================================
     */

    // ১. Profile Create / Update (Upsert)
    app.post('/api/lawyer/profile', validateBody(lawyerProfileSchema), async (req, res) => {
      try {
        const { userId, email, name, bio, fee, specialization, image, status, isPublished, isVerified } = req.body;

        if (!userId || !email) {
          return res.status(400).json({ success: false, error: "Missing required User ID or Email" });
        }

        const filter = { email: email };
        
        const updateFields = { updatedAt: new Date(), userId: userId };
        if (email !== undefined) updateFields.email = email;
        if (name !== undefined) updateFields.name = name;
        if (bio !== undefined) updateFields.bio = bio;
        if (fee !== undefined) updateFields.fee = parseFloat(fee) || 0;
        if (specialization !== undefined) updateFields.specialization = specialization;
        if (image !== undefined) updateFields.image = image;
        if (status !== undefined) updateFields.status = status; 
        if (isPublished !== undefined) updateFields.isPublished = isPublished; 
        if (isVerified !== undefined) updateFields.isVerified = isVerified; 

        const updateDoc = { $set: updateFields };

        const result = await lawyerCollection.updateOne(filter, updateDoc, { upsert: true });
        res.status(200).json({ success: true, message: "Profile saved successfully!", data: result });
      } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });

    // ২. ড্যাশবোর্ডের জন্য প্রোফাইল খোঁজার রুট (কোয়েরি ইমেইল দিয়ে)
    app.get('/api/lawyer/profile', validateQuery(lawyerEmailQuerySchema), async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) {
          return res.status(400).json({ success: false, error: "Email parameter required" });
        }

        const profile = await lawyerCollection.findOne({ email: email });
        
        if (!profile) {
          return res.status(200).json({ success: true, data: null });
        }

        res.status(200).json({ success: true, data: profile });
      } catch (error) {
        console.error("Error fetching lawyer profile:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });

    // 💡 ৩. ডায়নামিক রাউট: ফ্রন্টএন্ড Details Page-এর জন্য ইমেইল দিয়ে লইয়ার খোঁজা
    app.get('/api/lawyers/email/:email', validateParams(lawyerEmailParamSchema), async (req, res) => {
      try {
        const lawyerEmail = req.params.email;
        const lawyer = await lawyerCollection.findOne({ email: lawyerEmail });
        
        if (!lawyer) {
          return res.status(404).json({ success: false, message: "Lawyer not found" });
        }
        res.status(200).json(lawyer);
      } catch (err) {
        console.error("Error fetching lawyer by dynamic email:", err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // ৪. ড্যাশবোর্ড থেকে সার্ভিস/প্রোফাইল ডিলিট করার রুট
    app.delete('/api/lawyer/profile/:userId', validateParams(lawyerUserIdParamSchema), async (req, res) => {
      try {
        const { userId } = req.params;
        
        if (!userId) {
          return res.status(400).json({ success: false, error: "User ID is required" });
        }

        const result = await lawyerCollection.deleteOne({ userId: userId });

        if (result.deletedCount === 0) {
          return res.status(404).json({ success: false, error: "No active service found to delete" });
        }

        res.status(200).json({ success: true, message: "Your legal service has been deleted successfully!" });
      } catch (error) {
        console.error("Error deleting lawyer service:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });

    // 💡 ৫. সব লয়ারের ডাটা গেট করা (Browse Lawyers Page - সার্চ, ফিল্টার ও পেজিনেশন সামঞ্জস্য)
    app.get('/api/lawyer/all', validateQuery(lawyerAllQuerySchema), async (req, res) => {
      try {
        const { search, specialization, minFee, maxFee, status, page, limit } = req.query;
        
        let query = { isPublished: true, isVerified: true };

        if (search) {
          query.$or = [
            { name: { $regex: search, $options: "i" } },
            { bio: { $regex: search, $options: "i" } },
            { specialization: { $regex: search, $options: "i" } }
          ];
        }

        if (specialization) {
          query.specialization = specialization;
        }

        if (status) {
          query.status = status;
        }

        if (minFee || maxFee) {
          query.fee = {};
          if (minFee) query.fee.$gte = parseFloat(minFee);
          if (maxFee) query.fee.$lte = parseFloat(maxFee);
        }

        const currentPage = parseInt(page) || 1;
        const pageLimit = parseInt(limit) || 6;
        const skip = (currentPage - 1) * pageLimit;

        const totalLawyers = await lawyerCollection.countDocuments(query);
        const totalPages = Math.ceil(totalLawyers / pageLimit);

        const lawyers = await lawyerCollection
          .find(query)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(pageLimit)
          .toArray();

        res.status(200).json({ 
          success: true, 
          data: lawyers,
          pagination: {
            totalLawyers,
            totalPages,
            currentPage,
            limit: pageLimit
          }
        });
      } catch (error) {
        console.error("Error fetching all lawyers:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });


    // GET: /api/lawyer/featured
app.get("/api/lawyer/featured", async (req, res) => {
  try {
    let featuredLawyers = await database.collection("lawyers")
      .find({ isFeatured: true })
      .limit(6)
      .toArray();

    if (featuredLawyers.length < 6) {
      const remainingLimit = 6 - featuredLawyers.length;
      const alreadyTakenIds = featuredLawyers.map(l => l._id);
      
      const latestLawyers = await database.collection("lawyers")
        .find({ _id: { $nin: alreadyTakenIds } })
        .sort({ createdAt: -1 }) 
        .limit(remainingLimit)
        .toArray();

      featuredLawyers = [...featuredLawyers, ...latestLawyers];
    }

    // 💡 স্মার্ট সমাধান: রেসপন্স পাঠানোর আগে প্রতিটি লয়ার অবজেক্টে 'id' প্রোপার্টি যোগ করা হচ্ছে
    const sanitizedLawyers = featuredLawyers.map(lawyer => ({
      ...lawyer,
      id: lawyer._id.toString(), // _id এর পাশাপাশি সাধারণ id ও থাকবে
    }));

    res.status(200).json({
      success: true,
      data: sanitizedLawyers // ম্যাপ করা ডাটা পাঠানো হচ্ছে
    });

  } catch (error) {
    console.error("Error fetching featured lawyers:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

    /**
     * =================================================================
     * AI-POWERED LEGAL ISSUE ANALYZER & SMART LAWYER RECOMMENDER
     * =================================================================
     */
    function escapeRegExp(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    app.post('/api/ai/analyze-issue', validateBody(analyzeIssueSchema), async (req, res) => {
try {
        const { issue } = req.body;

        let analysis = null;

        // ১) Gemini (AI) দিয়ে ইস্যু অ্যানালাইসিস — API কী সেট থাকলে
        if (aiModel) {
          try {
            const promptResult = await aiModel.generateContent({
              contents: [{ role: 'user', parts: [{ text: buildUserPrompt(issue) }] }],
            });
            const rawText = promptResult.response.text();

            let parseError = null;
            try {
              analysis = JSON.parse(rawText);
            } catch (e) {
              parseError = e;
            }

            // কখনো কখনো মডেল মার্কডাউন ফেন্স দিয়ে ফেরত দেয় → স্ট্রিপ করে নেওয়া
            if (!analysis) {
              const fence = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
              if (fence) {
                try { analysis = JSON.parse(fence[1]); } catch (e) { parseError = e; }
              }
            }

            if (!analysis) {
              console.error("AI JSON parse failed:", parseError && parseError.message, rawText.slice(0, 200));
              analysis = null;
            }
          } catch (aiError) {
            console.error("Gemini API error:", aiError.message);
            analysis = null;
          }
        }

        // ২) ফলব্যাক: AI না থাকলে/ব্যর্থ হলে সাধারণ কীওয়ার্ড শ্রেণীবিন্যাস
        if (!analysis) {
          analysis = keywordFallback(issue, SUPPORTED_CATEGORIES);
        }

        // ৩) ক্যাটাগরি অনুযায়ী যাচাই করা (published + verified) লইয়ার খোঁজা
        const matchedCategory = analysis.matchedSpecialization || analysis.category || null;
        const catPattern = new RegExp(escapeRegExp(matchedCategory), 'i');

        const recommendedLawyers = await lawyerCollection
          .find({
            isPublished: true,
            isVerified: true,
            specialization: { $regex: catPattern },
          })
          .limit(6)
          .toArray();

        res.status(200).json({
          success: true,
          source: aiModel ? 'gemini' : 'keyword-fallback',
          analysis,
          recommendedLawyers,
        });
      } catch (error) {
        console.error("AI analyze-issue error:", error);
        res.status(500).json({ success: false, error: "AI analysis failed. Please try again." });
      }
    });

    // সহজ কীওয়ার্ড-ভিত্তিক ফলব্যাক ক্লাসিফায়ার (Gemini না থাকলে বা fail করলে)
    function keywordFallback(issueText, categories) {
      const text = issueText.toLowerCase();
      const weights = {
        "Criminal Law": ["crime", "criminal", "arrest", "police", "theft", "assault", "bail", "murder", "fraud", "drug"],
        "Corporate Law": ["company", "business", "contract", "shareholder", "partnership", "employment agreement", "startup", "incorporat", "tax"],
        "Family Law": ["divorce", "marriage", "custody", "child", "alimony", "dowry", "separation", "guardian", "adoption"],
        "Property Law": ["property", "land", "rent", "tenant", "landlord", "eviction", "house", "apartment", "real estate", "title", "mortgage"],
        "Civil Law": ["defamation", "tort", "negligence", "injury", "damage", "dispute", "complaint", "consumer court", "refund"],
        "Consumer Law": ["refund", "return", "warranty", "defective", "overcharge", "delivery", "consumer", "product"],
        "Labor Law": ["job", "salary", "wage", "termination", "dismissal", "employee", "employer", "labor", "leave", "overtime", "union"],
      };

      let bestCategory = "Consumer Law";
      let bestScore = 0;

      for (const [category, keywords] of Object.entries(weights)) {
        const score = keywords.reduce((acc, kw) => (text.includes(kw) ? acc + 1 : acc), 0);
        if (score > bestScore) {
          bestScore = score;
          bestCategory = category;
        }
      }

      return {
        category: bestCategory,
        summary: `Based on your description, this appears to relate to ${bestCategory.toLowerCase()} matters.`,
        urgency: "medium",
        nextSteps: [
          "Gather any documents, receipts, or correspondence related to your situation.",
          "Review the recommended lawyers below and check their consultation fees.",
          "Contact the lawyer most relevant to your issue for a professional consultation.",
        ],
        matchedSpecialization: bestCategory,
        disclaimer: "AI-generated guidance is for information only and is not legal advice.",
      };
    }

    /**
     * =================================================================
     * PAYMENT INTEGRATION (STRIPE COMFIRMATION)
     * =================================================================
     */
    app.post('/api/payment/confirm', validateBody(paymentConfirmSchema), async (req, res) => {
      try {
        const bodyData = req.body || {};
        const queryData = req.query || {};

        const session_id = bodyData.session_id || queryData.session_id;
        let email = bodyData.email || queryData.email;

        if (!session_id) {
          return res.status(400).json({ success: false, error: "Stripe Session ID is required" });
        }

        const session = await stripe.checkout.sessions.retrieve(session_id);

        if (session.payment_status === 'paid') {
          if (session.metadata && session.metadata.email) {
            email = session.metadata.email;
          }

          if (!email || email === 'undefined' || email === 'null') {
            return res.status(400).json({ success: false, error: "Email missing" });
          }

          const filter = { email: email }; 
          const updateDoc = {
            $set: {
              isVerified: true,
              isPublished: true, 
              paymentSessionId: session_id,
              verifiedAt: new Date()
            }
          };

          const result = await lawyerCollection.updateOne(filter, updateDoc);

          try {
            await transactionCollection.insertOne({
              transactionId: session.payment_intent || session_id,
              userEmail: email,
              amount: session.amount_total ? (session.amount_total / 100) : 0, 
              date: new Date(),
              purpose: "Lawyer Profile Fee"
            });
          } catch (transError) {
            console.error("Optional transaction log failed but profile active:", transError);
          }

          return res.status(200).json({ 
            success: true, 
            message: "Profile activated successfully!",
            data: result
          });
        } else {
          return res.status(400).json({ success: false, error: "Unpaid session." });
        }
      } catch (error) {
        console.error("CRITICAL ERROR IN PAYMENT CONFIRM:", error);
        res.status(500).json({ success: false, error: error.message || "Internal Server Error" });
      }
    });



    // 🌟 নতুন রাউট: ক্লায়েন্ট পেমেন্ট সাকসেস হলে হায়ার স্ট্যাটাস এবং এডমিন ট্রানজেকশন আপডেট করা
app.post('/api/payment/confirm-hiring', validateBody(paymentConfirmSchema), async (req, res) => {
  try {
    const { session_id } = req.body;

    if (!session_id) {
      return res.status(400).json({ success: false, error: "Stripe Session ID is required" });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === 'paid') {
     
      const { hiringId, clientEmail } = session.metadata;

      
      const actualAmount = session.amount_total ? (session.amount_total / 100) : 0;

      if (!hiringId) {
        return res.status(400).json({ success: false, error: "Hiring ID missing in session metadata" });
      }

      // ক) hiringCollection-এ স্ট্যাটাস আপডেট
      const updateHiring = await hiringCollection.updateOne(
        { _id: new ObjectId(hiringId) },
        { $set: { status: "paid", paymentStatus: "paid", paidAt: new Date() } }
      );

      
      const existingTx = await transactionCollection.findOne({ transactionId: session.id });
      
      if (!existingTx) {
        await transactionCollection.insertOne({
          transactionId: session.id, 
          userEmail: clientEmail || session.customer_details?.email, 
          amount: actualAmount, 
          date: new Date(),
          purpose: "Lawyer Hiring Fee" 
        });
      }

      // গ) পেমেন্ট সফল হলে ক্লায়েন্ট ও লইয়ার উভয়ের জন্য কেস ট্র্যাকিং রেকর্ড তৈরি করা হয়।
      try {
        const hiredRecord = await hiringCollection.findOne({ _id: new ObjectId(hiringId) });
        const existingCase = await casesCollection.findOne({ hiringId });
        if (!existingCase && hiredRecord) {
          await createCaseRecord({
            hiringId: hiredRecord._id.toString(),
            title: `Case with ${hiredRecord.clientName || "Client"} - ${hiredRecord.specialization || "Legal Matter"}`,
            clientUserId: await resolveUserIdByEmail(hiredRecord.clientEmail),
            clientEmail: hiredRecord.clientEmail,
            clientName: hiredRecord.clientName,
            lawyerUserId: await resolveUserIdByEmail(hiredRecord.lawyerEmail),
            lawyerEmail: hiredRecord.lawyerEmail,
            lawyerName: hiredRecord.lawyerName,
            specialization: hiredRecord.specialization,
          });
        }
      } catch (caseErr) {
        console.error("Optional case auto-creation failed (hiring still confirmed):", caseErr.message);
      }

      return res.status(200).json({ 
        success: true, 
        message: "Hiring status updated and transaction saved for admin directory!",
        data: updateHiring
      });
    } else {
      return res.status(400).json({ success: false, error: "Transaction verification pending/failed on Stripe." });
    }
  } catch (error) {
    console.error("Error confirming hiring payment:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

    /**
     * =================================================================
     * HIRING MANAGEMENT SYSTEM
     * =================================================================
     */
    
    // ১. Send Hiring Request
    app.post('/api/hiring/request', validateBody(hiringRequestSchema), async (req, res) => {
      try {
        const hiringData = req.body;

        const alreadyRequested = await hiringCollection.findOne({
          lawyerId: hiringData.lawyerId,
          clientEmail: hiringData.clientEmail,
          status: { $in: ["pending", "accepted"] }
        });

        if (alreadyRequested) {
          return res.status(400).json({ 
            success: false, 
            error: `You already have a ${alreadyRequested.status} request for this lawyer.` 
          });
        }

        const result = await hiringCollection.insertOne({
          ...hiringData,
          status: "pending", 
          paymentStatus: "unpaid", 
          requestDate: new Date() 
        });

        res.status(201).json({ success: true, message: "Hiring request sent successfully", data: result });
      } catch (error) {
        console.error("Error in hiring request:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });

    // 🌟 ২. ক্লায়েন্টের ইমেইল দিয়ে তার সব রিকোয়েস্ট হিস্ট্রি আনা (For user/hiring-history)
    app.get('/api/hiring/client/:email', validateParams(hiringEmailParamSchema), async (req, res) => {
      try {
        const { email } = req.params;
        const history = await hiringCollection
          .find({ clientEmail: email })
          .sort({ requestDate: -1 })
          .toArray();
        
        res.status(200).json({ success: true, data: history });
      } catch (error) {
        console.error("Error fetching client hiring history:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });

    // 🌟 ৩. লইয়ারের ইমেইল দিয়ে তার কাছে আসা সব রিকোয়েস্ট আনা (For lawyer/hiring-history)
    app.get('/api/hiring/lawyer/:email', validateParams(hiringEmailParamSchema), async (req, res) => {
      try {
        const { email } = req.params;
        const requests = await hiringCollection
          .find({ lawyerEmail: email })
          .sort({ requestDate: -1 })
          .toArray();
        
        res.status(200).json({ success: true, data: requests });
      } catch (error) {
        console.error("Error fetching lawyer requests:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });

    // 🌟 ৪. লইয়ার কর্তৃক রিকোয়েস্ট Accept বা Reject করার রুট 
    app.patch('/api/hiring/update-status/:id', validateParams(hiringIdParamSchema), validateBody(hiringStatusBodySchema), async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body; // 

        if (!["accepted", "rejected"].includes(status)) {
          return res.status(400).json({ success: false, error: "Invalid status code" });
        }

       
        const result = await hiringCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: status, statusUpdatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ success: false, error: "Hiring request not found" });
        }

        res.status(200).json({ success: true, message: `Request successfully ${status}` });
      } catch (error) {
        console.error("Error updating hiring status:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });




    // user ---



  
app.put('/user/:email', validateParams(userEmailParamSchema), validateBody(userUpsertBodySchema), async (req, res) => {
  try {
    const email = req.params.email;
    const user = req.body;
    const query = { email: email };
    const options = { upsert: true }; 
    
    const updateDoc = {
      $set: {
        name: user.name || 'Anonymous',
        email: email,
        image: user.image || 'https://via.placeholder.com/150',
        role: user.role || 'user', 
      }
    };
    
    const result = await usersCollection.updateOne(query, updateDoc, options);
    res.json(result); 
  } catch (error) {
    console.error("Error in PUT /user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ৩. সিঙ্গেল ইউজারের প্রোফাইল ডাটা গেট করার এন্ডপয়েন্ট (ড্যাশবোর্ডের জন্য)
app.get('/user/:email', validateParams(userEmailParamSchema), async (req, res) => {
  try {
    const email = req.params.email;
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    
    
    if (!user) {
      return res.status(200).json(null); 
    }
    
    res.json(user); 
  } catch (error) {
    console.error("Error in GET /user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ৪. প্রোফাইল আপডেট করার এন্ডপয়েন্ট (নাম ও ছবি)
app.patch('/user/update-profile/:email', validateParams(userEmailParamSchema), validateBody(userUpdateProfileSchema), async (req, res) => {
  try {
    const email = req.params.email;
    const { name, image } = req.body;
    const filter = { email: email };
    
   
    const options = { upsert: true }; 

    const updatedDoc = {
      $set: { 
        name: name, 
        image: image,
        email: email 
      }
    };

    const result = await usersCollection.updateOne(filter, updatedDoc, options);
    res.json(result); 
  } catch (error) {
    console.error("Error in PATCH /user/update-profile:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});





// Comment section


// ১. কমেন্ট পোস্ট করার এপিআই (আগেরটাই ঠিক আছে)
app.post("/api/comments", validateBody(commentCreateSchema), async (req, res) => {
  try {
    const { lawyerId, userEmail, userName, commentText } = req.body;
    if (!lawyerId || !userEmail || !commentText) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const hasPaidThisLawyer = await hiringCollection.findOne({
      clientEmail: userEmail,
      lawyerId: lawyerId, 
      status: "paid"
    });

    if (!hasPaidThisLawyer) {
      return res.status(403).json({ 
        success: false, 
        message: "You must hire this specific lawyer before leaving a review!" 
      });
    }

    const newComment = {
      lawyerId: lawyerId.toString(), 
      userEmail,
      userName,
      commentText,
      createdAt: new Date()
    };

    const result = await commentsCollection.insertOne(newComment);
    res.status(201).json({ success: true, data: { ...newComment, _id: result.insertedId } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ২. নির্দিষ্ট লয়ারের সব কমেন্ট গেট করার এপিআই (আগেরটাই ঠিক আছে)
app.get("/api/comments/:lawyerId", async (req, res) => {
  try {
    const { lawyerId } = req.params;
    const comments = await commentsCollection
      .find({ lawyerId: lawyerId })
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json({ success: true, data: comments });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🌟 নতুন যোগ করতে হবে: লগইন থাকা ইউজারের সব কমেন্ট গেট করার এপিআই (ড্যাশবোর্ডের জন্য)
app.get("/api/user-comments", validateQuery(userCommentsQuerySchema), async (req, res) => {
  try {
    const { email } = req.query; 
    if (!email) return res.status(400).json({ success: false, message: "Email required" });

    const comments = await commentsCollection
      .find({ userEmail: email })
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json({ success: true, data: comments });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ৩. কমেন্ট এডিট/আপডেট করার এপিআই (UPDATED)
app.put("/api/comments/:id", validateParams(commentIdParamSchema), validateBody(commentUpdateBodySchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { commentText, userEmail } = req.body; 

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid ID format" });
    }

    const comment = await commentsCollection.findOne({ _id: new ObjectId(id) });
    if (!comment || comment.userEmail !== userEmail) {
      return res.status(403).json({ success: false, message: "Unauthorized to edit this comment" });
    }

    await commentsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { commentText, updatedAt: new Date() } }
    );

    res.status(200).json({ success: true, message: "Comment updated successfully!" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ৪. কমেন্ট ডিলিট করার এপিআই (UPDATED to use Query Parameter)
app.delete("/api/comments/:id", validateParams(commentIdParamSchema), validateQuery(commentDeleteQuerySchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query; 

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid ID format" });
    }

    const comment = await commentsCollection.findOne({ _id: new ObjectId(id) });
    if (!comment || comment.userEmail !== email) {
      return res.status(403).json({ success: false, message: "Unauthorized to delete this comment" });
    }

    await commentsCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).json({ success: true, message: "Comment deleted successfully!" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.get("/api/hirings/check", validateQuery(hiringsCheckQuerySchema), async (req, res) => {
  const { clientEmail, lawyerId } = req.query;
  const match = await hiringCollection.findOne({
    clientEmail,
    lawyerId,
    status: "paid"
  });
  res.json({ hasPaid: !!match });
});



/**
 * =================================================================
 * ADMINISTRATIVE MANAGEMENT ROUTES (ADMIN ONLY)
 * =================================================================
 */

// ক) সব ইউজারের ডাটা গেট করার এপিআই (/api/users)
app.get('/api/users', async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// খ) ইউজারের রোল চেঞ্জ/আপডেট করার এপিআই (/api/users/:id/role)
app.patch('/api/users/:id/role', validateParams(userIdParamSchema), validateBody(userRoleBodySchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role: role } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, message: "User role updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// গ) ইউজার চিরতরে ডিলিট করার এপিআই (/api/users/:id)
app.delete('/api/users/:id', validateParams(userIdParamSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ঘ) সব ট্র্যানজেকশন ডাটা রিকভার করার এপিআই (/api/transactions)
app.get('/api/transactions', async (req, res) => {
  try {
    const transactions = await transactionCollection.find().sort({ date: -1 }).toArray();
    res.status(200).json({ success: true, transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 📊 ঙ) ড্যাশবোর্ড অ্যানালিটিক্স ওভারভিউ জেনারেট করার এন্ডপয়েন্ট (/api/admin/analytics)
app.get('/api/admin/analytics', async (req, res) => {
  try {
    const totalUsers = await usersCollection.countDocuments();
    const totalLawyers = await lawyerCollection.countDocuments({ isPublished: true });
    const totalHires = await hiringCollection.countDocuments({ status: "paid" });

   
    const revenueAggregation = await transactionCollection.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" } 
        }
      }
    ]).toArray();

    
    const totalRevenue = revenueAggregation.length > 0 ? revenueAggregation[0].total : 0;

    res.status(200).json({
      success: true,
      totalUsers,
      totalLawyers,
      totalHires,
      totalRevenue: Number(totalRevenue).toFixed(2) 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});









  
    // await database.command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");

    /**
     * =================================================================
     * REAL-TIME CLIENT-LAWYER MESSAGING (REST + Socket.io)
     * =================================================================
     */

    // Shared internal helper: validates both parties belong to the hiring,
    // stores the message, and broadcasts it to the conversation room.
    async function saveChatMessage({ hiringId, senderEmail, senderName, receiverEmail, text }) {
      if (!ObjectId.isValid(hiringId)) return { ok: false, status: 400, error: "Invalid hiring ID" };

      const hiring = await hiringCollection.findOne({ _id: new ObjectId(hiringId) });
      if (!hiring) return { ok: false, status: 404, error: "Hiring request not found" };

      const parties = [hiring.clientEmail, hiring.lawyerEmail].filter(Boolean);
      if (!parties.includes(senderEmail) || !parties.includes(receiverEmail)) {
        return { ok: false, status: 403, error: "You are not a participant of this conversation" };
      }

      const senderRole = senderEmail === hiring.clientEmail ? "user" : "lawyer";
      const senderFullName =
        senderName ||
        (senderEmail === hiring.clientEmail ? hiring.clientName : hiring.lawyerName) ||
        senderEmail;

      const message = {
        hiringId,
        senderEmail,
        senderName: senderFullName,
        senderRole,
        receiverEmail,
        text,
        read: false,
        readAt: null,
        timestamp: new Date(),
      };

      const result = await messagesCollection.insertOne(message);
      const savedMessage = { ...message, _id: result.insertedId };

      io.to(`hiring:${hiringId}`).emit("new_message", savedMessage);

      return { ok: true, message: savedMessage };
    }

    // POST: /api/messages — send a single message (also broadcast in real-time)
    app.post('/api/messages', validateBody(messageCreateSchema), async (req, res) => {
      try {
        const { hiringId, senderEmail, senderName, receiverEmail, text } = req.body;
        const saved = await saveChatMessage({ hiringId, senderEmail, senderName, receiverEmail, text });

        if (!saved.ok) {
          return res.status(saved.status).json({ success: false, error: saved.error });
        }

        res.status(201).json({ success: true, data: saved.message });
      } catch (error) {
        console.error("POST /api/messages error:", error);
        res.status(500).json({ success: false, error: "Failed to send message" });
      }
    });

    // GET: /api/messages/:hiringId — fetch conversation history
    app.get('/api/messages/:hiringId', validateParams(messageHiringIdParamSchema), async (req, res) => {
      try {
        const { hiringId } = req.params;
        const messages = await messagesCollection
          .find({ hiringId })
          .sort({ timestamp: 1 })
          .limit(200)
          .toArray();

        res.status(200).json({ success: true, data: messages });
      } catch (error) {
        console.error("GET /api/messages/:hiringId error:", error);
        res.status(500).json({ success: false, error: "Failed to load messages" });
      }
    });

    // PATCH: /api/messages/:id/read — mark a single message as read by its recipient
    app.patch(
      '/api/messages/:id/read',
      validateParams(messageIdParamSchema),
      validateBody(messageReadBodySchema),
      async (req, res) => {
        try {
          const { id } = req.params;
          const { readerEmail } = req.body;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: "Invalid message ID" });
          }

          const message = await messagesCollection.findOne({ _id: new ObjectId(id) });
          if (!message) {
            return res.status(404).json({ success: false, error: "Message not found" });
          }
          if (message.receiverEmail !== readerEmail) {
            return res.status(403).json({ success: false, error: "You are not the recipient of this message" });
          }

          await messagesCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { read: true, readAt: new Date() } }
          );

          io.to(`hiring:${message.hiringId}`).emit('message_read', {
            hiringId: message.hiringId,
            messageId: id,
            readerEmail,
          });

          res.status(200).json({ success: true, data: { _id: id, read: true } });
        } catch (error) {
          console.error("PATCH /api/messages/:id/read error:", error);
          res.status(500).json({ success: false, error: "Failed to update read status" });
        }
      }
    );

    /**
     * Socket.io event listeners
     * Rooms are named `hiring:<hiringId>` (one conversation per hiring request).
     */
    io.on('connection', (socket) => {
      console.log('Socket connected:', socket.id);

      // Join the conversation room (+ a per-user room for push convenience)
      socket.on('join_room', ({ hiringId, email }) => {
        if (hiringId) socket.join(`hiring:${hiringId}`);
        if (email) socket.join(`user:${email}`);
        socket.emit('joined_room', { hiringId, email });
      });

      socket.on('leave_room', ({ hiringId }) => {
        if (hiringId) socket.leave(`hiring:${hiringId}`);
      });

      // Real-time message send (server persists + broadcasts to the room)
      socket.on('send_message', async (payload) => {
        const { hiringId, senderEmail, senderName, receiverEmail, text } = payload || {};
        if (!hiringId || !senderEmail || !receiverEmail || !text) return;

        try {
          const saved = await saveChatMessage({ hiringId, senderEmail, senderName, receiverEmail, text });
          if (!saved.ok) {
            socket.emit('send_message_error', { hiringId, error: saved.error });
          }
        } catch (error) {
          console.error('Socket send_message error:', error);
          socket.emit('send_message_error', { hiringId, error: 'Failed to send message' });
        }
      });

      // Bulk mark-all-unread-as-read when a participant opens the chat
      socket.on('message:read', async ({ hiringId, readerEmail }) => {
        if (!hiringId || !readerEmail) return;
        try {
          const result = await messagesCollection.updateMany(
            { hiringId, receiverEmail: readerEmail, read: false },
            { $set: { read: true, readAt: new Date() } }
          );
          if (result.modifiedCount > 0) {
            io.to(`hiring:${hiringId}`).emit('messages_read', { hiringId, readerEmail });
          }
        } catch (error) {
          console.error('Socket message:read error:', error);
        }
      });

      // Typing indicators (broadcast to everyone else in the room)
      socket.on('typing', ({ hiringId, email, isTyping }) => {
        socket.to(`hiring:${hiringId}`).emit('typing', { hiringId, email, isTyping });
      });

      socket.on('disconnect', () => {
        console.log('Socket disconnected:', socket.id);
      });
    });

    /**
     * =================================================================
     * LAWYER AVAILABILITY & BOOKING CALENDAR
     * =================================================================
     */

    const WEEK_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    function timeToMinutes(t) {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    }

    // POST /api/availability — create or overwrite a lawyer's weekly schedule
    app.post('/api/availability', validateBody(availabilityBodySchema), async (req, res) => {
      try {
        const { lawyerEmail, slots } = req.body;

        for (const slot of slots) {
          if (timeToMinutes(slot.start) >= timeToMinutes(slot.end)) {
            return res.status(400).json({
              success: false,
              error: `Invalid slot for ${slot.day}: start time must be before end time`,
            });
          }
        }

        const updatedAt = new Date();
        await availabilityCollection.updateOne(
          { lawyerEmail },
          { $set: { lawyerEmail, slots, updatedAt } },
          { upsert: true }
        );

        const availability = await availabilityCollection.findOne({ lawyerEmail });
        res.status(200).json({ success: true, data: availability });
      } catch (error) {
        console.error("POST /api/availability error:", error);
        res.status(500).json({ success: false, error: "Failed to save availability" });
      }
    });

    // GET /api/availability?lawyerEmail=... — fetch a lawyer's weekly schedule
    app.get('/api/availability', validateQuery(availabilityQuerySchema), async (req, res) => {
      try {
        const { lawyerEmail } = req.query;
        const availability = await availabilityCollection.findOne({ lawyerEmail });
        res.status(200).json({ success: true, data: availability });
      } catch (error) {
        console.error("GET /api/availability error:", error);
        res.status(500).json({ success: false, error: "Failed to load availability" });
      }
    });

    // DELETE /api/availability?lawyerEmail=... — remove a lawyer's schedule entirely
    app.delete('/api/availability', validateQuery(availabilityQuerySchema), async (req, res) => {
      try {
        const { lawyerEmail } = req.query;
        const result = await availabilityCollection.deleteOne({ lawyerEmail });
        res.status(200).json({ success: true, deleted: result.deletedCount > 0 });
      } catch (error) {
        console.error("DELETE /api/availability error:", error);
        res.status(500).json({ success: false, error: "Failed to delete availability" });
      }
    });

    // POST /api/bookings — client requests a consultation slot
    app.post('/api/bookings', validateBody(bookingCreateSchema), async (req, res) => {
      try {
        const { lawyerEmail, lawyerName, clientEmail, clientName, date, startTime, endTime, notes } = req.body;

        if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
          return res.status(400).json({ success: false, error: "Start time must be before end time" });
        }

        const chosenDate = new Date(
          Number(date.slice(0, 4)),
          Number(date.slice(5, 7)) - 1,
          Number(date.slice(8, 10))
        );
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        if (isNaN(chosenDate.getTime()) || chosenDate.getTime() < startOfToday.getTime()) {
          return res.status(400).json({ success: false, error: "Booking date must be today or in the future" });
        }

        // Verify the requested time lies within one of the lawyer's configured slots
        const availability = await availabilityCollection.findOne({ lawyerEmail });
        const dayOfWeek = WEEK_DAY_NAMES[chosenDate.getDay()];
        const configured = availability?.slots?.some(
          (s) =>
            s.day === dayOfWeek &&
            timeToMinutes(startTime) >= timeToMinutes(s.start) &&
            timeToMinutes(endTime) <= timeToMinutes(s.end)
        );

        if (!configured) {
          return res.status(400).json({ success: false, error: "Selected time is not within the lawyer's available schedule" });
        }

        // Prevent double-booking against pending/accepted requests
        const overlap = await bookingsCollection.findOne({
          lawyerEmail,
          date,
          status: { $in: ["pending", "accepted"] },
          startTime: { $lt: endTime },
          endTime: { $gt: startTime },
        });

        if (overlap) {
          return res.status(400).json({ success: false, error: "That time slot is already booked or requested" });
        }

        const booking = {
          lawyerEmail,
          lawyerName,
          clientEmail,
          clientName,
          date,
          startTime,
          endTime,
          notes: notes || "",
          replyNote: "",
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(booking);
        res.status(201).json({ success: true, data: { _id: result.insertedId, ...booking } });
      } catch (error) {
        console.error("POST /api/bookings error:", error);
        res.status(500).json({ success: false, error: "Failed to create booking" });
      }
    });

    // GET /api/bookings?lawyerEmail=... | ?clientEmail=... — list bookings
    app.get('/api/bookings', validateQuery(bookingQuerySchema), async (req, res) => {
      try {
        const filter = {};
        if (req.query.lawyerEmail) filter.lawyerEmail = req.query.lawyerEmail;
        if (req.query.clientEmail) filter.clientEmail = req.query.clientEmail;

        const bookings = await bookingsCollection
          .find(filter)
          .sort({ date: 1, createdAt: 1 })
          .limit(200)
          .toArray();

        res.status(200).json({ success: true, data: bookings });
      } catch (error) {
        console.error("GET /api/bookings error:", error);
        res.status(500).json({ success: false, error: "Failed to load bookings" });
      }
    });

    // PATCH /api/bookings/:id — accept, reject, cancel, or complete a booking
    app.patch(
      '/api/bookings/:id',
      validateParams(bookingIdParamSchema),
      validateBody(bookingStatusBodySchema),
      async (req, res) => {
        try {
          const { id } = req.params;
          const { status, replyNote } = req.body;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: "Invalid booking ID" });
          }

          const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
          if (!booking) {
            return res.status(404).json({ success: false, error: "Booking not found" });
          }

          // When accepting, refuse if that slot is already taken by another accepted booking
          if (status === "accepted") {
            const conflict = await bookingsCollection.findOne({
              _id: { $ne: new ObjectId(id) },
              lawyerEmail: booking.lawyerEmail,
              date: booking.date,
              status: "accepted",
              startTime: { $lt: booking.endTime },
              endTime: { $gt: booking.startTime },
            });
            if (conflict) {
              return res.status(409).json({ success: false, error: "This slot conflicts with an already-accepted booking" });
            }
          }

          await bookingsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status, updatedAt: new Date(), ...(replyNote ? { replyNote } : {}) } }
          );

          const updated = await bookingsCollection.findOne({ _id: new ObjectId(id) });
          res.status(200).json({ success: true, data: updated });
        } catch (error) {
          console.error("PATCH /api/bookings/:id error:", error);
          res.status(500).json({ success: false, error: "Failed to update booking" });
        }
      }
    );

    /**
     * =================================================================
     * MULTI-PARTY CASE TRACKING & VISUAL TIMELINE
     * =================================================================
     */

    // POST /api/cases — create a case linked to a hiring request/client/lawyer
    app.post('/api/cases', validateBody(caseCreateSchema), async (req, res) => {
      try {
        const {
          hiringId,
          title,
          clientUserId,
          clientEmail,
          clientName,
          lawyerUserId,
          lawyerEmail,
          lawyerName,
          specialization,
        } = req.body;

        if (!ObjectId.isValid(hiringId)) {
          return res.status(400).json({ success: false, error: "Invalid hiring ID" });
        }

        const existingCase = await casesCollection.findOne({ hiringId });
        if (existingCase) {
          return res.status(200).json({ success: true, data: existingCase, alreadyExists: true });
        }

        const caseDoc = await createCaseRecord({
          hiringId,
          title,
          clientUserId: clientUserId || (await resolveUserIdByEmail(clientEmail)),
          clientEmail,
          clientName,
          lawyerUserId: lawyerUserId || (await resolveUserIdByEmail(lawyerEmail)),
          lawyerEmail: lawyerEmail || "",
          lawyerName: lawyerName || "",
          specialization: specialization || "",
        });

        res.status(201).json({ success: true, data: caseDoc, alreadyExists: false });
      } catch (error) {
        console.error("POST /api/cases error:", error);
        res.status(500).json({ success: false, error: "Failed to create case" });
      }
    });

    // GET /api/cases/:id — fetch case details and current milestone
    app.get('/api/cases/:id', validateParams(caseIdParamSchema), async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ success: false, error: "Invalid case ID" });
        }

        const caseDoc = await casesCollection.findOne({ _id: new ObjectId(id) });
        if (!caseDoc) {
          return res.status(404).json({ success: false, error: "Case not found" });
        }

        res.status(200).json({ success: true, data: caseDoc });
      } catch (error) {
        console.error("GET /api/cases/:id error:", error);
        res.status(500).json({ success: false, error: "Failed to fetch case" });
      }
    });

    // GET /api/cases/user/:userId — list cases for a client OR lawyer (optionally by email too)
    app.get(
      '/api/cases/user/:userId',
      validateParams(caseUserIdParamSchema),
      validateQuery(caseUserQuerySchema),
      async (req, res) => {
        try {
          const { userId } = req.params;
          const { email } = req.query;

          const match = { $or: [] };
          if (userId) {
            match.$or.push({ clientUserId: userId }, { lawyerUserId: userId });
          }
          if (email) {
            match.$or.push({ clientEmail: email }, { lawyerEmail: email });
          }
          if (match.$or.length === 0) {
            return res.status(200).json({ success: true, data: [] });
          }

          const cases = await casesCollection
            .find(match)
            .sort({ updatedAt: -1 })
            .toArray();

          res.status(200).json({ success: true, data: cases });
        } catch (error) {
          console.error("GET /api/cases/user/:userId error:", error);
          res.status(500).json({ success: false, error: "Failed to fetch cases" });
        }
      }
    );

    // PATCH /api/cases/:id/status — advance stage, mark milestone complete, add notes, or change case status
    app.patch(
      '/api/cases/:id/status',
      validateParams(caseIdParamSchema),
      validateBody(caseStatusBodySchema),
      async (req, res) => {
        try {
          const { id } = req.params;
          if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: "Invalid case ID" });
          }

          const current = await casesCollection.findOne({ _id: new ObjectId(id) });
          if (!current) {
            return res.status(404).json({ success: false, error: "Case not found" });
          }

          const { caseStatus, advance, setStage, completeCurrentStage, note, stageDate } = req.body;

          let status = current.status || "active";
          let activeIndex =
            typeof current.currentStageIndex === "number" ? current.currentStageIndex : 0;
          let timeline = Array.isArray(current.timeline) && current.timeline.length > 0
            ? current.timeline
            : buildCaseTimeline(activeIndex);
          let progressNotes = Array.isArray(current.progressNotes) ? current.progressNotes : [];

          if (caseStatus) status = caseStatus;

          if (completeCurrentStage === true || advance === true) {
            const atLastStage = activeIndex >= CASE_STAGE_TITLES.length - 1;
            if (atLastStage) {
              timeline = timeline.map((m) => ({
                ...m,
                status: "completed",
                date: m.date || (stageDate ? new Date(stageDate) : new Date()),
              }));
              status = status === "closed" ? status : "completed";
            } else {
              activeIndex += 1;
              timeline = recomputeTimeline(timeline, activeIndex, stageDate);
            }
          } else if (setStage !== undefined) {
            activeIndex = setStage;
            timeline = recomputeTimeline(timeline, activeIndex, stageDate);
          }

          if (note && note.text) {
            const entry = {
              text: note.text,
              authorEmail: note.authorEmail || "",
              authorName: note.authorName || "",
              role: note.role || "lawyer",
              createdAt: new Date(),
            };
            progressNotes.push(entry);
            timeline = timeline.map((m, index) =>
              index === activeIndex
                ? { ...m, notes: m.notes ? [...m.notes, entry] : [entry] }
                : m
            );
          }

          await casesCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status,
                currentStageIndex: activeIndex,
                currentStage: CASE_STAGE_KEYS[activeIndex] || "",
                currentStageLabel: CASE_STAGE_TITLES[activeIndex] || "",
                timeline,
                progressNotes,
                updatedAt: new Date(),
              },
            }
          );

          const updated = await casesCollection.findOne({ _id: new ObjectId(id) });
          res.status(200).json({ success: true, data: updated });
        } catch (error) {
          console.error("PATCH /api/cases/:id/status error:", error);
          res.status(500).json({ success: false, error: "Failed to update case status" });
        }
      }
    );

  } catch (error) {
    console.error("MongoDB Setup Error:", error);
  }
}
run().catch(console.dir);

server.listen(port, () => {
  console.log(`LegalEase app listening on port ${port}`);
});

// Vercel: @vercel/node routes incoming requests to the exported app.
// `server.listen` above keeps local development working unchanged.
module.exports = app;