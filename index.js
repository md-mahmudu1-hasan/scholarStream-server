const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
require("dotenv").config();
const app = express();
const Stripe = require("stripe");
const port = process.env.PORT || 3000;

const stripe = new Stripe(process.env.STRIP_SECRET);

const admin = require("firebase-admin");

// const serviceAccount = require("./key.json");

// const serviceAccount = require("./firebase-admin-key.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

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

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6l2dtxw.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // await client.connect();
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

    app.get("/users", verifyToken, async (req, res) => {
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
      try {
        const {
          page = 1,
          limit = 6,
          search = "",
          subject = "",
          location = "",
          sort = "date_desc", // default newest first
        } = req.query;

        const skip = (Number(page) - 1) * Number(limit);

        // 🔍 Search + Filter Query
        const query = {
          $and: [
            search
              ? {
                  $or: [
                    { scholarshipName: { $regex: search, $options: "i" } },
                    { universityName: { $regex: search, $options: "i" } },
                    { degree: { $regex: search, $options: "i" } },
                  ],
                }
              : {},
            subject ? { subject } : {},
            location ? { location } : {},
          ],
        };

        // 🔃 Sort Logic
        let sortQuery = {};
        if (sort === "fee_asc") sortQuery = { applicationFees: 1 };
        if (sort === "fee_desc") sortQuery = { applicationFees: -1 };
        if (sort === "date_asc") sortQuery = { createdAt: 1 };
        if (sort === "date_desc") sortQuery = { createdAt: -1 };

        const total = await scoleCollection.countDocuments(query);

        const scholarships = await scoleCollection
          .find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(Number(limit))
          .toArray();

        res.send({
          data: scholarships,
          total,
          page: Number(page),
          totalPages: Math.ceil(total / limit),
        });
      } catch (error) {
        res.status(500).send({ message: "Server Error" });
      }
    });

    app.get("/applications/universityName/stats", async (req, res) => {
      const pipeline = [
        {
          $group: {
            _id: "$universityName",
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            universityName: "$_id",
            count: 1,
            // _id: 0
          },
        },
      ];
      const result = await applicationsCollection.aggregate(pipeline).toArray();
      res.send(result);
    });
    app.get("/scholarship/:id", async (req, res) => {
      const id = req.params.id;
      const scolership = await scoleCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(scolership);
    });

    app.get("/applications", async (req, res) => {
      try {
        const email = req.query.email;
        let query = {};
        if (email) {
          query = { ApplicantEmail: email };
        }

        const applications = await applicationsCollection
          .find(query)
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

    app.patch("/applications/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;

      const result = await applicationsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );

      res.send(result);
    });

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

    // await client.db("admin").command({ ping: 1 });
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
