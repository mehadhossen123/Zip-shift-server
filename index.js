const express = require("express");
const cors = require("cors");
require("dotenv").config();
const nodemon = require("nodemon");
const app = express();

// Middle ware

app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;
 const crypto=require("crypto")

function generateTrackingId() {
  const prefix = "ZP"; // change if you want
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(4).toString("hex").toUpperCase(); // 8 chars
  return `${prefix}-${date}-${random}`;
}


// here setup the database url

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
// Stripe url

const stripe = require("stripe")(process.env.STRIPE_SECRET);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.g6tkuix.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("Zap_shift_db");
    const parcelCollection = database.collection("parcels");
    const paymentCollection=database.collection("payments")

    // get data form database
    app.get("/parcels", async (req, res) => {
      try {
        // console.log(req.query)
        const query = {};
        const options = { sort: { createdAt: -1 } };

        const { email } = req.query;
        if (email) {
          query.senderEmail = email;
        }

        const cursor = parcelCollection.find(query, options);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Internal server error ",
        });
      }
    });

    // post data into database

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
        res.status(500).send({
          success: false,
          message: "Internal server error",
        });
      }
    });

    // Delete api is here
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await parcelCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Internal server error",
        });
      }
    });

    //Find one parcels to payment
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await parcelCollection.findOne(query);

        //  if not found
        if (!result) {
          return res.status(404).send({
            success: false,
            message: "Parcel not found",
          });
        }

        // success
        res.send(result);
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Internal server error",
        });
      }
    });

    // Payment related api

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
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
      console.log(session);
      res.send({ url: session.url });

      // res.redirect(303, session.url);
    });



    // payment success related api
    app.patch("/payment-success",async (req,res)=>{
      const sessionId=req.query.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const transactionId=session.payment_intent;
      const query = { transaction: transactionId };
      const findByTId=await paymentCollection.findOne(query);
      console.log(findByTId)
      if(findByTId){
        return res.send({
          message:"Parcel is already exits",
          transactionId,
          trackingId:findByTId.trackingId
        })
      }

      if(session.payment_status==="paid"){
        const id=session.metadata.parcelId;
        const query={_id:new ObjectId(id)}
        const trackingId=generateTrackingId()
        const update = {
          $set: {
            paymentStatus:"paid",
            trackingId:trackingId
          },
        };
        const result=await parcelCollection.updateOne(query,update)

        const paymentHistory = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.name,
          transaction: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };
         if (session.payment_status === "paid"){
          const paymentResult=await paymentCollection.insertOne(paymentHistory)
          res.send({
            success: true,
            modifyParcel: result,
            paymentInfo: paymentResult,
            trackingId: trackingId,
            transactionId: session.payment_intent,
          });
         }

    }})

    
    // Payment history related api
     app.get("/payments",async (req,res)=>{
      const email=req.query.email;
       const query={}
       if(email){
        query .customerEmail=email;
       }
       const result=await paymentCollection.find(query).toArray()
       res.send(result)

     })

  
      



    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("zip shift  server is runing !");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
