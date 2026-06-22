const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();

const port = process.env.PORT || 8000;


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

    
    app.get('/', (req, res) => {
      res.send('LegalEase Server is Running Perfectly!');
    });

    
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