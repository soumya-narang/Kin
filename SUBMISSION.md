# Kin: an Alexa+ care companion for parents who live alone

## The problem

Millions of older adults live alone while their children live in another city or country. Those children get one of two things: silence, or a phone call where "I'm fine" is the only answer.

## What Kin is

Kin is an Alexa+ integration built on the Model Context Protocol (MCP). The parent talks to Alexa the way they already do:

> "I took my sugar tablet." · "Felt dizzy again when I got up." · "Feeling a bit low, the house is very quiet."

Kin logs it, remembers it across days, and notices what no single conversation can see. For example: *dizziness reported three times this week, each time on or right after a day the blood-pressure tablet was missed.* When a pattern like that appears, Kin tells the family on its own, explains why, and tells the parent it has done so. The family can reply, and Kin reads the message aloud on the parent's speaker; whatever the parent says back ("tell Priya I'm feeling better") reaches the family. Kin also speaks first: a morning hello when nothing has been heard, and a gentle nudge when a dose is half an hour late.

There are two sides to the product:

- **The parent** uses voice only. No app, no setup, no new habits.
- **The family** gets a dashboard (care level, what Kin noticed and why, alerts sent, the parent's day as a story, a 14-day timeline, mood and sleep trends, a daily digest), can message the parent through Kin, and can ask questions such as "How has Mum been sleeping?". Both sides use the same MCP server and the same care record.

## How it works

```
Parent speaks -> Alexa+ (simulated device) -> Agent on Amazon Bedrock (Converse + tool use)
    -> MCP (Streamable HTTP) -> Kin MCP server -> Care engine -> Amazon DynamoDB
                                                      |
                                                      +-> Amazon SNS (SMS / email to family)
                                                      +-> Family dashboard -> "Ask Kin" -> agent
```

**Kin MCP server (`src/mcp`).** Streamable HTTP, protocol `2025-11-25`. Tools: `get_care_context`, `log_medication`, `log_symptom`, `log_mood`, `log_sleep`, `log_note`, `get_trends`, `notify_family`, `schedule_reminder`, `get_family_briefing`, `message_family`, `message_parent`. Resources: `kin://household/profile` and `kin://household/insights`. Every log call re-evaluates the care picture and may notify the family. State is persisted, so it survives sessions and devices.

**Care engine (`src/care`).** Turns two weeks of logs into findings: medication adherence, recurring symptoms, mood and sleep drift, red-flag symptoms, and cross-signal patterns such as symptoms lining up with missed doses. The engine is deterministic. The model explains and acts on findings; it does not invent them. Escalation is calm by design: at most one alert per pattern every 12 hours, while red-flag phrases (chest pain, a fall, trouble breathing) escalate immediately and the parent is told to call emergency services. Kin never diagnoses.

**Voice agent (`src/agent`).** Amazon Bedrock Converse API with tool use. It connects to the Kin MCP server as an MCP client, the same way Alexa+ would, and handles both the parent's speech and the family's questions.

**Conversation (`src/care/conversation.ts`).** Messages both ways, and the check-ins Kin starts itself. Family messages are read aloud only between conversations, never over the parent. Each check-in has a stable id, so it is said at most once. What Kin said unprompted in the last half hour is passed to the agent, so the parent's reply is understood in context.

**Simulated Alexa+ device (`public/speaker.html`).** Voice in and out in the browser, with a live "behind the scenes" panel that shows every MCP tool call. Between conversations it speaks family messages, reminders and check-ins on its own.

**Family dashboard (`public/family.html`).** Care level, findings with reasons, alerts, timeline, trends, an AI-written daily digest, and Ask Kin.

## Amazon developer tools and services used

| Tool / service | How Kin uses it |
| --- | --- |
| **Amazon Bedrock (Converse API, tool use)** | The model behind the voice agent. Default model is `us.amazon.nova-pro-v1:0`; any Converse model with tool use works via `KIN_MODEL_ID`. |
| **Alexa+ and the Model Context Protocol** | Kin is designed as an MCP server that an Alexa+ agent connects to. The agent in this repo is an MCP client built to behave the way Alexa+ would. |
| **Amazon DynamoDB** | Persistent care record in a single table (`pk = HH#<household>`; `sk` is `PROFILE`, `LOG#...`, `ALERT#...` or `REMINDER#...`). |
| **Amazon SNS** | Delivers family alerts by SMS or email, with the reasons included. |
| **AWS SDK for JavaScript v3** | Bedrock Runtime, DynamoDB document client, and SNS clients. |
| **AWS App Runner / ECS** | A `Dockerfile` is included for hosting. `/mcp` can require a bearer token (`KIN_MCP_TOKEN`). |

The IAM permissions needed are `bedrock:InvokeModel`, `dynamodb:GetItem/PutItem/Query/BatchWriteItem` on the table, and `sns:Publish` on the topic.

## What is simulated and what is real

**Real**

- The MCP server: a standards-compliant Streamable HTTP server that any MCP client can connect to (check it with `npm run inspect`).
- The MCP client in the agent, and every tool call the agent makes through it.
- The care engine and its findings, escalation rules, 12-hour cooldown and red-flag handling.
- Amazon Bedrock Converse calls with tool use, when `KIN_LLM=bedrock`.
- DynamoDB persistence, when `KIN_TABLE` is set.
- SNS delivery to subscribed email or phone endpoints, when `KIN_SNS_TOPIC_ARN` is set. If SNS is not configured or the publish fails, the alert is still recorded on the dashboard.
- Spoken output and input in the browser, using the Web Speech API (Chrome or Edge).
- Messages between the family and the parent: stored in the care record, read aloud on the speaker, and sent to the family through SNS when it is configured.
- Morning check-ins and late-dose nudges, triggered by the clock and the care record.

**Simulated**

- **The Alexa+ device.** The "Echo" is a web page. Kin is not published as an Alexa skill or integration, and it has not been tested on a physical Echo or with the real Alexa+ service. The MCP interface is the integration point, but the Alexa-side connection is not demonstrated here.
- **"Have Kin check in now".** A demo button that makes Kin start a check-in immediately instead of waiting for the morning or a late dose. It can be switched off with `KIN_DISABLE_DEMO_RESET=true`.
- **The household.** Kamala, 74, in Pune, with two weeks of history, is seeded demo data. The data is not from real people. "Reset demo" reloads it.
- **Local fallbacks.** With `KIN_LLM=mock` and no table or topic configured, the agent is rule-based, storage is a JSON file in `./data`, and alerts appear on the dashboard only. This mode exists so the UI runs without credentials. It is not what the demo claims to show.
- **Alternate model providers.** Optional providers (any OpenAI-compatible API, or the Claude API) can drive the agent in place of Bedrock. They exist for development on free tiers; the MCP server, care engine and dashboard are identical.
- **Clinical validity.** The thresholds and patterns are reasonable heuristics, not clinically validated. Kin reports what was said and what it noticed, and suggests calling the family or the doctor.

## Run it

```bash
npm install
cp .env.example .env      # KIN_LLM=mock runs without AWS
npm start
```

- Start here: http://localhost:3000
- Parent device: http://localhost:3000/speaker.html
- Family dashboard: http://localhost:3000/family.html
- MCP endpoint: http://localhost:3000/mcp

The README covers the AWS setup (Bedrock model access, DynamoDB table, SNS topic).

## Design choices

- **Voice first for the parent, visual for the family.** Older adults won't install an app, but they will talk to the speaker in the kitchen. Adult children want the "why", not raw data.
- **Patterns, not pings.** One dizzy spell is not an alert. Dizziness that keeps lining up with missed blood-pressure doses is.
- **Their own words.** The family sees what their parent actually said, not only a score.
- **Deterministic findings, model for language.** The care engine decides what is true; the model decides how to say it.

## Team and links

- Repository: https://github.com/soumya-narang/Kin
- Demo video: _add link before submitting_
- Team: _add names before submitting_
