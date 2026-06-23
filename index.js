const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();

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

    // টেস্ট রুট
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
        const { userId, name, bio, fee, specialization, image } = req.body;

        if (!userId || !name) {
          return res.status(400).json({ success: false, error: "Missing required fields" });
        }

        const filter = { userId: userId };
        const updateDoc = {
          $set: {
            userId,
            name,
            bio,
            fee: parseFloat(fee) || 0,
            specialization,
            image,
            status: "Available", 
            updatedAt: new Date()
          }
        };

        const result = await lawyerCollection.updateOne(filter, updateDoc, { upsert: true });
        res.status(200).json({ success: true, message: "Profile updated successfully!" });
      } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });

    // ২. ড্যাশবোর্ডের ফর্ম অটো-ফিল এবং সিঙ্গেল প্রোফাইল ভিউ করার রুট
    app.get('/api/lawyer/profile', async (req, res) => {
      try {
        const { userId } = req.query;
        if (!userId) {
          return res.status(400).json({ success: false, error: "User ID required" });
        }

        const profile = await lawyerCollection.findOne({ userId: userId });
        
        if (!profile) {
          return res.status(200).json({ success: true, data: null });
        }

        res.status(200).json({ success: true, data: profile });
      } catch (error) {
        console.error("Error fetching lawyer profile:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });

    // ৩. 💡 ড্যাশবোর্ড টেবিল বা অ্যাকশন থেকে সার্ভিস/প্রোফাইল ডিলিট করার নতুন রাউট (DELETE)
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

    // ৪. সব লয়ারের ডাটা গেট করা (Browse Lawyer পেজের জন্য এপিআই সামঞ্জস্য করা হলো)
    app.get('/api/lawyer/all', async (req, res) => {
      try {
        const lawyers = await lawyerCollection
          .find({})
          .sort({ updatedAt: -1 })
          .toArray();

        res.status(200).json({ success: true, data: lawyers });
      } catch (error) {
        console.error("Error fetching all lawyers:", error);
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