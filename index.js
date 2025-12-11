const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

    app.post("/scolership", async (req, res) => {
      const newScole = req.body;
      newScole.createdAt = new Date();
      const result = await scoleCollection.insertOne(newScole);
      res.send(result);
    });

    app.post("/reviews", async (req, res) => {
      const review = req.body;
      review.createdAt = new Date();
      const result = await reviewCollection.insertOne(review);
      res.send(result);
    });


    // GET user by id
    app.get("/users/:id", async (req, res) => {
      const id = req.params.id;
      const user = await userCollection.findOne({ _id: new ObjectId(id) });
      res.send(user);
    });

    app.get("/users", async (req, res) => {
      const email = req.query.email;
      if (email) {
        const user = await userCollection.findOne({ email: email });
        return res.send(user);
      }
      const users = await userCollection.find({}).toArray();
      res.send(users);
    });

    app.get("/scolership", async (req, res) => {
      const scolership = await scoleCollection.find({}).sort({ createdAt: -1 }).toArray();
      res.send(scolership);
    });

    app.get("/scholarship/:id", async (req, res) => {
      const id = req.params.id;
      const scolership = await scoleCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(scolership);
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

    app.delete("/scolership/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await scoleCollection.deleteOne(query);
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
