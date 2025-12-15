const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
require("dotenv").config();
const app = express();
const Stripe = require("stripe");
const port = process.env.PORT || 3000;

const stripe = new Stripe(process.env.STRIP_SECRET);

const admin = require("firebase-admin");

const serviceAccount = require("./key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(cors());
app.use(express.json());

const verifyToken = async (req, res, next) => {
  const token = req.headers?.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const uri =
  "mongodb+srv://scolership:EPKPXqemfiA4T5Gr@cluster0.6l2dtxw.mongodb.net/?appName=Cluster0";
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
    const database = client.db("scoler_db");
    const userCollection = database.collection("userInfo");
    const scoleCollection = database.collection("scoleInfo");
    const reviewCollection = database.collection("reviews");
    const applicationsCollection = database.collection("applications");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };
    const verifyModerator = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "moderator") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    //post method
    app.post("/users", async (req, res) => {
      const newUser = req.body;
      newUser.role = "student";
      newUser.createdAt = new Date();
      const email = newUser.email;

      const userExist = await userCollection.findOne({ email });
      if (userExist) {
        return res.status(409).send({ message: "user exists" });
      }
      const result = await userCollection.insertOne(newUser);
      res.send(result);
    });

    app.post("/scholarship", async (req, res) => {
      const newScole = req.body;
      newScole.createdAt = new Date();
      const result = await scoleCollection.insertOne(newScole);
      res.send(result);
    });

    app.post("/reviews/:id", async (req, res) => {
      try {
        const scholarshipId = req.params.id;
        const review = req.body;
        review.scholarshipId = scholarshipId;
        review.createdAt = new Date();

        const result = await reviewCollection.insertOne(review);

        res.send({
          success: true,
          message: "Review added successfully",
          data: result,
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Something went wrong",
          error: error.message,
        });
      }
    });

    app.post("/applications", async (req, res) => {
      const applications = req.body;
      applications.createdAt = new Date();
      applications.paymentStatus = "Unpaid";
      const result = await applicationsCollection.insertOne(applications);
      res.send(result);
    });

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo.ScholarshipName,
              },
              unit_amount: Number(paymentInfo.applicationFees * 100),
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.ApplicantEmail,
        mode: "payment",
        metadata: {
          applicationId: paymentInfo.applicationId,
        },
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id=${paymentInfo.applicationId}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-canceled?session_id=${paymentInfo.applicationId}`,
      });

      res.send({ url: session.url });
    });

    // GET Methode

    app.get("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const user = await userCollection.findOne({ _id: new ObjectId(id) });
      res.send(user);
    });

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.query.email;
      if (email) {
        const user = await userCollection.findOne({ email: email });
        return res.send(user);
      }
      const users = await userCollection.find({}).toArray();
      res.send(users);
    });

    app.get("/users/:email/role", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "student" });
    });

    app.get("/scholarship", async (req, res) => {
      const scolership = await scoleCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      res.send(scolership);
    });

    app.get("/scholarship/:id", async (req, res) => {
      const id = req.params.id;
      const scolership = await scoleCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(scolership);
    });

    app.get("/applications", verifyToken, verifyModerator, async (req, res) => {
      try {
        const applications = await applicationsCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).send(applications);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch applications" });
      }
    });

    app.get("/applications/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const applications = await applicationsCollection
          .find({ _id: new ObjectId(id) })
          .toArray();
        res.send(applications);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get("/reviews/:id", async (req, res) => {
      try {
        const scholarshipId = req.params.id;
        const reviews = await reviewCollection
          .find({ scholarshipId })
          .toArray();
        res.send(reviews);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get("/reviews", verifyToken, async (req, res) => {
      try {
        const userEmail = req.query.userEmail;

        let query = {};
        if (userEmail) {
          query.userEmail = userEmail;

          if (userEmail !== req.decoded_email) {
            return res.status(403).send({ message: "forbidden access" });
          }
        }

        const reviews = await reviewCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.send({
          success: true,
          data: reviews,
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Something went wrong",
          error: error.message,
        });
      }
    });

    // patch mathode

    app.patch("/scholarship/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      try {
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: updatedData,
        };

        const result = await scoleCollection.updateOne(filter, updateDoc);

        res.send({
          success: true,
          message: "Scholarship updated successfully",
          result,
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Update failed",
          error: error.message,
        });
      }
    });

    app.patch("/users/:id", async (req, res) => {
      const id = req.params.id;
      const role = req.body.role;
      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );
      res.send(result);
    });

    app.patch(
      "/applications/:id",
      verifyToken,
      verifyModerator,
      async (req, res) => {
        const id = req.params.id;
        const updateData = req.body;

        const result = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        res.send(result);
      }
    );

    app.patch("/reviews/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { reviewComment, ratingPoint } = req.body;

        const updateDoc = {
          $set: {
            reviewComment,
            ratingPoint,
          },
        };

        const result = await reviewCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc
        );

        res.send({
          success: result.modifiedCount > 0,
          message: "Review updated",
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: error.message,
        });
      }
    });

    // delete mathode

    app.delete("/scholarship/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await scoleCollection.deleteOne(query);
      res.send(result);
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await userCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });
    app.delete(
      "/applications/:id",
      verifyToken,
      verifyModerator,
      async (req, res) => {
        const id = req.params.id;
        const result = await applicationsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );
    app.delete("/reviews/:id", async (req, res) => {
      const id = req.params.id;
      const result = await reviewCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server is running on ${port}`);
});
