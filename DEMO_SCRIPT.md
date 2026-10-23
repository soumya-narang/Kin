# Kin: 3-minute demo script

Target runtime: 3:00. Roughly 380 spoken words. Screen recording with voiceover; the parent's lines are spoken aloud into the simulated device.

**Before recording**

- Start with `KIN_LLM=bedrock` and `KIN_SNS_TOPIC_ARN` set, so the Bedrock and SNS shots are real. Storage is a local file in this setup (no `KIN_TABLE`), so do not mention DynamoDB. Keep the subscribed inbox open in another tab.
- Click **Reset demo** on the dashboard so Kamala's history is fresh.
- Window layout: parent device at http://localhost:3000 on the left (open the "behind the scenes" panel), family dashboard at http://localhost:3000/family.html on the right. Use Chrome or Edge for voice.
- Have the SNS message ready on a phone or inbox tab.

---

## 0:00 to 0:25. The problem

**Screen:** Title card, then Kamala's profile on the dashboard (name, age, Pune).

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

**Screen:** Switch to the family dashboard. Show the 14-day timeline: BP tablet missed twice in the last four days, dizziness twice, mood and sleep trending down.

**Voiceover:**
"Two weeks of logs sit in Kin's care record. In the last four days Kamala missed her blood-pressure tablet twice, reported dizziness twice, and her mood and sleep have slipped. No single conversation shows this. Kin's care engine does."

**Screen:** Back to the parent device.

**Say aloud:** "I'm feeling dizzy again."

**Screen:** Behind-the-scenes panel shows `log_symptom`, then the family notification. Kin's spoken reply tells Kamala it has let her daughter know.

**Voiceover:**
"That completes the pattern: dizziness lining up with missed blood-pressure doses. Kin tells the family on its own, and it tells Kamala that it did, so nothing happens behind her back."

## 1:55 to 2:25. The family side

**Screen:** Show the phone or inbox with the SNS message arriving, then the dashboard alert.

**Voiceover:**
"Her daughter gets a message through Amazon SNS. It doesn't just say 'alert'. It says why: dizziness three times this week, two of them on or right after a missed blood-pressure dose. The dashboard shows the same finding with Kamala's own words."

**Screen:** In **Ask Kin**, type or say: "How has Mum been sleeping?" Show the answer and the daily digest.

**Voiceover:**
"The family can ask questions. Same MCP server, same care record."

## 2:25 to 2:45. Safety by design

**Screen:** Optional quick cut: say "I fell in the kitchen" and show the immediate escalation, or show the cooldown note on the alert.

**Voiceover:**
"Patterns, not pings: one alert per pattern every twelve hours. A fall or chest pain escalates immediately, and Kamala is told to call emergency services. Kin never diagnoses. The care engine is deterministic; the model explains what it found, it doesn't invent it."

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
