require("dotenv").config();
const { App, AwsLambdaReceiver } = require("@slack/bolt");
const fs = require("fs");
const setupEventListeners = require("./eventListeners");
const sessions = require("./sessions");

const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Initialize Slack app
const app = new App({
  receiver: awsLambdaReceiver,
  token: process.env.SLACK_BOT_TOKEN,
});

const customizationPrompt = fs
  .readFileSync("./puzzle_prompt.txt", "utf-8")
  .replace(/\n/g, " ");

setupEventListeners(app, sessions, customizationPrompt);

// Start the app
module.exports.handler = async (event, context, callback) => {
  const handler = await awsLambdaReceiver.start();
  return handler(event, context, callback);
};
