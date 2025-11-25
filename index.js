const express = require("express");
const cors = require("cors");
require("dotenv").config();
const nodemon = require("nodemon");
const app = express();

// Middle ware

app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

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
      const sessionId=req.params.session_id;
      res.send({status:true})
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
