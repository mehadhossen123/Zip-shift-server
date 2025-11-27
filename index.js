require("dotenv").config();

// Core imports
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

// Firebase
const admin = require("firebase-admin");
const serviceAccount = require("./zap-shift.json");

// MongoDB
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Stripe
const stripe = require("stripe")(process.env.STRIPE_SECRET);

// App init
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Firebase initialization
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Firebase token verification middleware
const verifyFToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized accessed " });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    res.status(401).send({ message: "Unauthorized accessed " });
  }
};

// Tracking ID generator
function generateTrackingId() {
  const prefix = "ZP";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${date}-${random}`;
}

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.g6tkuix.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    // create database and collection
    const database = client.db("Zap_shift_db");
    const parcelCollection = database.collection("parcels");
    const paymentCollection = database.collection("payments");
    const userCollection = database.collection("users");
    const riderCollection = database.collection("riders");

    // =============================
    // PARCEL APIs
    // =============================

    // User related api
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        const exists = await userCollection.findOne({ email: user?.email });
        if (exists) {
          return res.status(409).send({
            success: false,
            message: "User already exists",
          });
        }

        user.role = "user";
        user.createdAt = new Date();
        const result = await userCollection.insertOne(user);
        res.status(201).send({
          success: true,
          message: "User successfully created ",
          data: result,
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Internal server error ",
        });
      }
    });

    //Riders related aip

    app.post("/riders", async (req, res) => {
      try {
        const rider = req.body;
        const existsRider = await riderCollection.findOne({
          riderEmail: rider?.riderEmail,
        });

        if (existsRider) {
          return res.status(409).send({
            success: false,
            message: "User already exists",
          });
        }

        rider.status = "Pending";
        rider.createdAt = new Date();
        const result = await riderCollection.insertOne(rider);
        res.status(201).send({
          success: true,
          data: result,
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Internal server error",
        });
      }
    });
    // Get all riders
    app.get("/riders", async (req, res) => {
      try {
        const query = {};
        if (req.query.status) {
          query.status = req.query.status;
        }
        const result = await riderCollection.find(query).toArray();
        res.status(202).send({
          success: true,
          data: result,
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Internal server error",
        });
      }
    });

    
    // Approve rider
    app.patch("/riders/:id", verifyFToken, async (req, res) => {
      try {
        const riderId = req.params.id;
        const status = req.query.status;
        const query = { _id: new ObjectId(riderId) };
        const updateInfo = {
          $set: {
            status: status,
          },
        };
        const result = await riderCollection.updateOne(query,updateInfo);
        res.status(201).send({
          success: true,
          message: "Update successful",
          data: result,
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Internal server error",
        });
      }
    });

    // Get parcels
    app.get("/parcels", async (req, res) => {
      try {
        const query = {};
        const options = { sort: { createdAt: -1 } };
        const { email } = req.query;
        if (email) query.senderEmail = email;
        const result = await parcelCollection.find(query, options).toArray();
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal server error " });
      }
    });

    // Post parcel
    app.post("/parcels", async (req, res) => {
      try {
        const parcel = req.body;
        parcel.createdAt = new Date();
        const result = await parcelCollection.insertOne(parcel);
        res.send({
          success: true,
          message: "The parcel is added successfully",
          data: result,
        });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    // Delete parcel
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await parcelCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    // Get parcel by ID
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await parcelCollection.findOne(query);
        if (!result) {
          return res
            .status(404)
            .send({ success: false, message: "Parcel not found" });
        }
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    // =============================
    // PAYMENT APIs
    // =============================

    // Stripe checkout session create
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: { name: paymentInfo.parcelName },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          name: paymentInfo.parcelName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
      });
      res.send({ url: session.url });
    });

    // Payment success patch
    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const transactionId = session.payment_intent;

      const exists = await paymentCollection.findOne({
        transaction: transactionId,
      });
      if (exists) {
        return res.send({
          message: "Parcel is already exists",
          transactionId,
          trackingId: exists.trackingId,
        });
      }

      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const trackingId = generateTrackingId();

        await parcelCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { paymentStatus: "paid", trackingId } }
        );

        const paymentHistory = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.name,
          transaction: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId,
        };

        const paymentResult = await paymentCollection.insertOne(paymentHistory);

        res.send({
          success: true,
          paymentInfo: paymentResult,
          trackingId,
          transactionId: session.payment_intent,
        });
      }
    });

    // Payment history
    app.get("/payments", verifyFToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      if (email) {
        query.customerEmail = email;
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden accessed " });
        }
      }

      const result = await paymentCollection
        .find(query)
        .sort({ paidAt: -1 })
        .toArray();
      res.send(result);
    });

    // MongoDB ping
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}

run().catch(console.dir);

// Root route
app.get("/", (req, res) => {
  res.send("zip shift  server is runing !");
});

// Server start
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
