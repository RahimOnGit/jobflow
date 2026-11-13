const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 4000;
const DATA_FILE = path.join(__dirname, "data", "jobs.json");

app.use(express.json());

// Allow the extension (running as an extension origin) to call this local server.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

function readJobs() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

function writeJobs(jobs) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(jobs, null, 2));
}

app.get("/api/jobs", (req, res) => {
  res.json(readJobs());
});

app.post("/api/jobs", (req, res) => {
  const jobs = readJobs();
  const job = {
    id: Date.now(),
    ...req.body
  };
  jobs.push(job);
  writeJobs(jobs);
  res.status(201).json(job);
});

app.delete("/api/jobs/:id", (req, res) => {
  const jobs = readJobs().filter(j => String(j.id) !== req.params.id);
  writeJobs(jobs);
  res.sendStatus(204);
});

app.listen(PORT, () => {
  console.log(`JobFlow server running: http://localhost:${PORT}`);
  console.log(`Saving jobs to: ${DATA_FILE}`);
});
