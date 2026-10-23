# Kin: 3-minute demo script

Target runtime: 3:00. Roughly 380 spoken words. Screen recording with voiceover; the parent's lines are spoken aloud into the simulated device.

**Before recording**

- Start with `KIN_LLM=bedrock` and `KIN_SNS_TOPIC_ARN` set, so the Bedrock and SNS shots are real. Storage is a local file in this setup (no `KIN_TABLE`), so do not mention DynamoDB. Keep the subscribed inbox open in another tab.
- Click **Reset demo** on the dashboard so Kamala's history is fresh.
- Window layout: parent device at http://localhost:3000/speaker.html on the left (open the "behind the scenes" panel), family dashboard at http://localhost:3000/family.html on the right. Use Chrome or Edge for voice. Open http://localhost:3000 once for the opening shot.
- Have the SNS message ready on a phone or inbox tab.

---

## 0:00 to 0:25. The problem

**Screen:** The Kin home page: "Kamala's speaker" and "Family view" side by side. Then Kamala's speaker.

**Voiceover:**
"Millions of older adults live alone while their children live far away. Kamala is 74 and lives alone in Pune. Her daughter lives abroad. She won't install an app, but she talks to Alexa every day. Kin is an Alexa+ care companion, built on MCP, that turns those everyday conversations into care her family can see."

## 0:25 to 1:10. The parent just talks

**Screen:** Parent device, behind-the-scenes panel visible.

**Say aloud to the device:** "I took my sugar tablet."

**Voiceover while it replies:** "She speaks normally. On the right is what Alexa does behind the scenes: it calls `log_medication` on the Kin MCP server. This agent runs on Amazon Bedrock, using Converse with tool use, and it talks to Kin as an MCP client, the way Alexa+ would."

**Say aloud:** "I slept badly last night, only about four hours."

**Voiceover:** "She mentions a rough night. Kin logs it quietly. Nothing here is urgent, so nobody gets a message. But look at the history."

**Do not say anything about dizziness yet.** Kamala already has two dizziness reports in her seeded history, so the next one completes the pattern and triggers the alert. Save it for the 1:10 section.

## 1:10 to 1:55. The pattern

**Screen:** Switch to the family dashboard. Show the 14-day timeline: red marks on the blood-pressure tablet, dizziness showing up, mood and sleep trending down. (Exact counts shift with the time of day, so point at the pattern and do not read numbers.)

**Voiceover:**
"Two weeks of logs sit in Kin's care record. Over the last few days Kamala has missed her blood-pressure tablet, reported dizziness, and her mood and sleep have slipped. No single conversation shows this. Kin's care engine does."

**Screen:** Back to the parent device.

**Say aloud:** "I'm feeling dizzy again."

**Screen:** Behind-the-scenes panel shows `log_symptom`, then the family notification. Kin's spoken reply tells Kamala it has let her daughter know.

**Voiceover:**
"That completes the pattern: dizziness lining up with missed blood-pressure doses. Kin tells the family on its own, and it tells Kamala that it did, so nothing happens behind her back."

## 1:55 to 2:30. The family answers

**Screen:** The phone or inbox with the SNS message arriving, then the dashboard alert with its reasons.

**Voiceover:**
"Her daughter gets a message through Amazon SNS. It doesn't just say 'alert'. It says why: dizziness three times this week, each on or right after a missed blood-pressure dose. The dashboard shows the same finding with Kamala's own words."

**Screen:** Tap **Send a message** on the alert, pick "Please sit down and have some water. I'll call you soon.", send it. Cut to the speaker: within a few seconds it shows "Message from Priya" and reads it aloud.

**Voiceover:**
"Priya replies right from the alert. Kin waits for a quiet moment and reads it to Kamala in the kitchen. Same MCP server, same care record."

## 2:30 to 2:45. Kamala answers back

**Say aloud to the device:** "Tell Priya I'm feeling better now, don't worry."

**Screen:** `message_family` in the behind-the-scenes panel, then the reply appearing in the dashboard's message thread.

**Voiceover:**
"And Kamala answers back in her own words. Patterns, not pings: one alert per pattern every twelve hours, and Kin never diagnoses."

## 2:45 to 3:00. What's real, and close

**Screen:** Architecture diagram from the README.

**Voiceover:**
"To be clear about what's real: the MCP server, the agent on Amazon Bedrock, and the alert email through Amazon SNS are all live. The Alexa+ device is a browser simulation, the care record is a local file, and Kamala is seeded demo data. Kin: care that listens, so families don't have to ask."

**Screen:** End card with the repo link.

---

## Notes for the take

- If voice recognition misfires, type the line in the device's text box; the tool-call panel looks the same.
- Do not skip the "simulated" line at the end. Judges will check the claim against the repo.
- The alert goes out as an **email** through SNS, not SMS. Say "email".
- The speaker checks for messages every 6 seconds. Keep it idle (not mid-sentence) after Priya sends, or the message waits until Kamala's turn ends.
- For a shot of Kin starting the conversation itself, use **Have Kin check in now** at the bottom of the dashboard.
