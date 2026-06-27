const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();


const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;

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
    
    
    const lawyerCollection = database.collection("lawyers");
    const hiringCollection = database.collection("hirings");
    const transactionCollection = database.collection("transactions"); 
    const usersCollection = database.collection("users");
    const commentsCollection = database.collection("comments");
    
    app.get('/', (req, res) => {
      res.send('LegalEase Server is Running Perfectly!');
    });

    /**
     * =================================================================
     * LAWYER PROFILE & SERVICE MANAGEMENT ROUTES (CRUD)
     * =================================================================
     */

    // ১. Profile Create / Update (Upsert)
    app.post('/api/lawyer/profile', async (req, res) => {
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
    app.get('/api/lawyer/profile', async (req, res) => {
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
    app.get('/api/lawyers/email/:email', async (req, res) => {
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

    // 💡 ৫. সব লয়ারের ডাটা গেট করা (Browse Lawyers Page - সার্চ, ফিল্টার ও পেজিনেশন সামঞ্জস্য)
    app.get('/api/lawyer/all', async (req, res) => {
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

    /**
     * =================================================================
     * PAYMENT INTEGRATION (STRIPE COMFIRMATION)
     * =================================================================
     */
    app.post('/api/payment/confirm', async (req, res) => {
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
app.post('/api/payment/confirm-hiring', async (req, res) => {
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
    app.post('/api/hiring/request', async (req, res) => {
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
    app.get('/api/hiring/client/:email', async (req, res) => {
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
    app.get('/api/hiring/lawyer/:email', async (req, res) => {
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
    app.patch('/api/hiring/update-status/:id', async (req, res) => {
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



  
app.put('/user/:email', async (req, res) => {
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
app.get('/user/:email', async (req, res) => {
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
app.patch('/user/update-profile/:email', async (req, res) => {
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
app.post("/api/comments", async (req, res) => {
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
app.get("/api/user-comments", async (req, res) => {
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
app.put("/api/comments/:id", async (req, res) => {
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
app.delete("/api/comments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query; // 💡 ফিক্স: req.body এর বদলে req.query থেকে ইমেইল নেওয়া হচ্ছে

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


app.get("/api/hirings/check", async (req, res) => {
  const { clientEmail, lawyerId } = req.query;
  const match = await hiringCollection.findOne({
    clientEmail,
    lawyerId,
    status: "paid"
  });
  res.json({ hasPaid: !!match });
});


// লগইন থাকা ইউজারের সব কমেন্ট গেট করার নতুন এপিআই
app.get("/api/user-comments", async (req, res) => {
  try {
    const { email } = req.query; 
    if (!email) return res.status(400).json({ success: false, message: "Email required" });

    // userEmail ফিল্ড দিয়ে ডাটাবেজ থেকে ফিল্টার করা হচ্ছে
    const comments = await commentsCollection.find({ userEmail: email }).toArray();
    res.json({ success: true, data: comments });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
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
app.patch('/api/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!["user", "lawyer", "admin"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role specified" });
    }

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
app.delete('/api/users/:id', async (req, res) => {
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

    // 💡 ফিক্সড এগ্রিগেশন: সঠিক ডলার সাইন ($amount) ব্যবহার করা হলো
    const revenueAggregation = await transactionCollection.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" } // এখানে ওরিজিনাল কালেকশনের amount ফিল্ড যোগ হচ্ছে
        }
      }
    ]).toArray();

    // যদি কোনো ট্রানজেকশন না থাকে তবে ০ দেখাবে
    const totalRevenue = revenueAggregation.length > 0 ? revenueAggregation[0].total : 0;

    res.status(200).json({
      success: true,
      totalUsers,
      totalLawyers,
      totalHires,
      totalRevenue: Number(totalRevenue).toFixed(2) // দশমিকের পর ২ ঘর রাখার জন্য নিশ্চিত করা হলো
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});









    // মঙ্গোডিবি কানেকশন সাকসেস চেক
    await database.command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } catch (error) {
    console.error("MongoDB Setup Error:", error);
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`LegalEase app listening on port ${port}`);
});