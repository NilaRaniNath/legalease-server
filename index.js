const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();

// 💡 Stripe Secret Key লোড করা হচ্ছে এনভায়রনমেন্ট ভেরিয়েবল থেকে
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 8000;

// Middleware
app.use(cors());
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
    
    // কালেকশনস
    const lawyerCollection = database.collection("lawyers");
    const hiringCollection = database.collection("hirings");
    const transactionCollection = database.collection("transactions"); // এডমিন অ্যানালিটিক্সের জন্য নতুন কালেকশন

    // টেস্ট রুট
    app.get('/', (req, res) => {
      res.send('LegalEase Server is Running Perfectly!');
    });

    /**
     * =================================================================
     * LAWYER PROFILE & SERVICE MANAGEMENT ROUTES (CRUD)
     * =================================================================
     */

    // ১. Profile Create / Update (Upsert) - ফ্রন্টএন্ড ফর্মের সাথে সম্পূর্ণ সামঞ্জস্যপূর্ণ
    app.post('/api/lawyer/profile', async (req, res) => {
      try {
        const { userId, email, name, bio, fee, specialization, image, status, isPublished, isVerified } = req.body;

        // ডিফেন্সিভ কোডিং: ইমেইল এবং ইউজার আইডি দুটোই থাকা বাধ্যতামূলক
        if (!userId || !email) {
          return res.status(400).json({ success: false, error: "Missing required User ID or Email" });
        }

        // 💡 আপডেট: ইমেইল এবং ইউজার আইডি দুটোর কম্বিনেশনে ফিল্টার করা হচ্ছে যাতে ডেটা ডুপ্লিকেট না হয়
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

    // ২. ড্যাশবোর্ডের জন্য প্রোফাইল খোঁজার রুট (ইমেইল দিয়ে খোঁজা হচ্ছে)
    app.get('/api/lawyer/profile', async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) {
          return res.status(400).json({ success: false, error: "Email parameter required" });
        }

        // 💡 সরাসরি ইমেইল এড্রেস দিয়ে প্রোফাইল খোঁজা হচ্ছে
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

    // ৩. ড্যাশবোর্ড থেকে সার্ভিস/প্রোফাইল ডিলিট করার রুট
    app.delete('/api/lawyer/profile/:userId', async (req, res) => {
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

    // ৪. সব লয়ারের ডাটা গেট করা (Browse Lawyers Page)
    app.get('/api/lawyer/all', async (req, res) => {
      try {
        const { search, specialization, minFee, maxFee, status, page, limit } = req.query;
        
        // 💡 শুধুমাত্র Published এবং পেইড/Verified প্রোফাইলগুলোই ক্লায়েন্ট ডিরেক্টরিতে দেখাবে
        let query = { isPublished: true, isVerified: true };

        if (search) {
          query.$or = [
            { name: { $regex: search, $options: "i" } },
            { bio: { $regex: search, $options: "i" } }
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

        const lawyers = await lawyerCollection
          .find(query)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(pageLimit)
          .toArray();

        res.status(200).json({ 
          success: true, 
          total: totalLawyers,
          page: currentPage,
          limit: pageLimit,
          data: lawyers 
        });
      } catch (error) {
        console.error("Error fetching all lawyers:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });
// 💡 ৫. পেমেন্ট সফল হওয়ার পর ভেরিফিকেশন ও স্ট্যাটাস আপডেট (সেফটি অ্যান্ড ফলব্যাক ব্যাকড সংস্করণ)
app.post('/api/payment/confirm', async (req, res) => {
  try {
    // 💡 সেফটি চেক: req.body বা req.query অবজেক্ট ডিফেন্সিভলি হ্যান্ডেল করা হলো যাতে 'undefined' এরর না আসে
    const bodyData = req.body || {};
    const queryData = req.query || {};

    // বডি অথবা কুয়েরি—যে কোনো এক জায়গা থেকে ডাটা পেলেই তা রিসিভ করবে
    const session_id = bodyData.session_id || queryData.session_id;
    let email = bodyData.email || queryData.email;

    if (!session_id) {
      return res.status(400).json({ success: false, error: "Stripe Session ID is required" });
    }

    // স্ট্রাইপ সার্ভার থেকে পেমেন্ট স্ট্যাটাস কনফার্ম করা হচ্ছে
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === 'paid') {
      
      // যদি স্ট্রাইপ মেটাডাটাতে ইমেইল থাকে, তবে সেটি ফার্স্ট প্রায়োরিটি পাবে
      if (session.metadata && session.metadata.email) {
        email = session.metadata.email;
      }

      if (!email || email === 'undefined' || email === 'null') {
        return res.status(400).json({ success: false, error: "Verification failed. Associated user email could not be resolved." });
      }

      // মঙ্গোডিবি ফিল্টার - ইমেইল দিয়ে আইনজীবী খুঁজে বের করা হচ্ছে
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

      // এডমিন ট্রানজেকশন প্যানেলের জন্য ডাটা সেভ করা (কালেকশন এক্সিস্ট না করলে মঙ্গোডিবি অটো তৈরি করে নেবে)
      try {
        await database.collection("transactions").insertOne({
          transactionId: session.payment_intent || session_id,
          userEmail: email,
          amount: session.amount_total ? (session.amount_total / 100) : 0, 
          date: new Date(),
          purpose: "Lawyer Profile Activation Fee"
        });
      } catch (transError) {
        console.error("Optional transaction log failed:", transError);
        // মেইন পেমেন্ট সাকসেস হলে ট্রানজেকশন লগের জন্য যেন ইউজার এরর না দেখে
      }

      return res.status(200).json({ 
        success: true, 
        message: "Professional profile activated and verified successfully!",
        data: result
      });
    } else {
      return res.status(400).json({ success: false, error: "Stripe payment verification failed. Unpaid session." });
    }
  } catch (error) {
    console.error("Error in payment confirmation:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

    // মঙ্গোডিবি কানেকশন সাকসেস চেক
    await database.command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } catch (error) {
    console.dir(error);
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`LegalEase app listening on port ${port}`);
});