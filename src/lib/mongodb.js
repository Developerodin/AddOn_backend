const { MongoClient } = require('mongodb');

const url = 'mongodb://localhost:27017'; // Local MongoDB
const client = new MongoClient(url);

async function connectDB() {
  try {
    await client.connect();
    console.log("Connected to MongoDB!");
  } catch (error) {
    console.error("Connection failed:", error);
  }
}

connectDB();
