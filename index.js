const express = require("express");
const cors=require("cors");
require("dotenv").config();
const nodemon = require("nodemon");
const app = express();


// Middle ware 

app.use(cors())
app.use(express.json())

const port =process.env.PORT|| 3000

app.get("/", (req, res) => {
  res.send("zip shift  server is runing !");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
