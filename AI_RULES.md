# AI generation rules

The rules that decide what the AI in Ad Builder reads and writes. Listed in order of precedence:
when two rules apply, the earlier one wins. Every change to these rules is committed together
with the code that implements it. Ask for "the AI rules" and this file is the answer.

The same list is shown in the app under AI settings at the bottom of Ad Builder.

| # | Rule | Added | Why |
|---|------|-------|-----|
| 1 | The **Generate** button under Headlines derives headlines from the primary text already filled in step 1 (all non-empty variants). | 2026-09-12 | Headlines must match the copy's angle and offer. |
| 2 | If step 1 has no text, the Headlines button falls back to the brief from "Let AI build". | 2026-09-12 | Still useful before copy exists. |
| 3 | The **Generate** button under Ad copy derives copy from the headlines already filled in step 2. If none, it uses the brief. | 2026-09-12 | Mirror of rule 1. |
| 4 | If neither the source step nor the brief has content, the button asks for input instead of guessing. | 2026-09-12 | No invented campaigns. |
| 5 | **Let AI build** always works from the brief, and only fills steps that are empty or still default, except copy and headlines which it replaces. | 2026-09-12 | One-shot draft; existing structure is kept. |
| 6 | Generated items are appended to the list, never replacing what is already typed. Delete what you don't want. | 2026-09-12 | Nothing typed by a person is lost. |
| 7 | Generated text always stays editable; nothing is sent to Hermes without being visible in the steps first. | 2026-09-12 | Review before launch. |

## How to add a rule

Tell Claude the rule in plain language. It gets a number, a date, and a reason here, and the
code change lands in the same commit.
