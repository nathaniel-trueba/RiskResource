# 5. The state machine and the weekly schedule

## What Step Functions needs from you

A **state machine** is a JSON document (in "Amazon States Language") listing the steps, what each one runs, and what happens on errors. You can draw it in the console's visual editor (Workflow Studio), which writes the JSON for you, or paste JSON in. Below is the full definition with every setting explained.

**Type: Standard**, not Express. Standard workflows can run for up to a year, and the weekly run takes about 45 minutes. Express workflows are capped at 5 minutes. Standard costs $0.025 per 1,000 state transitions; a weekly run has about 20, so it's effectively free (4,000 free a month).

## The definition

It's in **`backend/aws/wildfire_state_machine.json`**. Paste it into Step Functions → Create state machine → "Code" view as is. It has no placeholders: it refers to the Lambdas by name (`wildfire-fetch-chunk` and so on), so the names you give them in 04 must match.

The flow:

```
DownloadWeather (Map over $.chunks, one at a time)
  └─ FetchChunk  → Lambda wildfire-fetch-chunk
BuildFeatures        → Lambda wildfire-build-features
CalibrateAndPublish  → Lambda wildfire-calibrate-publish (runs the model, publishes)
Any failure (after its retries) → the run fails, shown red in the console
```

### Each part, in plain terms

**`DownloadWeather` (Map).** Runs `FetchChunk` once per item in `$.chunks`, the list `[0,1,2,3,4,5,6,7]` passed in by the schedule.

- `ItemSelector` builds each chunk's input: its number, the total (8), and the run's start time, from which the Lambda works out the week.
- **`MaxConcurrency: 1`** is the rate limiter: one chunk at a time, 60 requests a minute overall. Only raise it to 2 if you've seen POWER tolerate ~120 a minute.
- `ResultPath: null` throws away the chunks' outputs so they don't bloat the next step's input. Their real output is the files in S3.

**`FetchChunk`'s `Retry`** is where rate limiting is handled. Retriers are checked in order, and the first match applies:

- `Throttled` (raised by our code when POWER returns 429): wait 60 s, then 120, 240, 480, 960 (`BackoffRate: 2`, up to 5 attempts). `JitterStrategy: FULL` randomizes each wait a bit, so retries don't line up.
- `ChunkIncomplete` (the chunk ran out of time, or too many cells failed): retry after 10 s, up to 4 times. Each retry carries on where the last one stopped.
- Lambda's own hiccups: retry 3 times starting at 30 s. That covers the function hitting its 15-minute timeout (`Sandbox.Timedout`), crashing, for example running out of memory (`Lambda.Unknown`), and AWS-side errors (`Lambda.ServiceException` and the like). The timeout shouldn't normally happen, because `fetch_chunk` stops itself 90 seconds early.
- Because downloads already in S3 are skipped, each retry only fetches what's missing.

**`BuildFeatures`.** One Lambda: the forecast plus features. It returns the week and where it wrote the CSV, saved under `$.features` for the last step to use. Retries twice, 2 and 4 minutes apart (Open-Meteo hiccups).

**`CalibrateAndPublish`.** Gets the week from `$.features.week`, runs the model on the features (under a second for 3,221 counties), calibrates, attaches county codes, and writes the weekly copy and then `latest.json`. Retries 3 times starting at 60 s. Rerunning it is safe: it just rewrites the same two files.

**Failures.** There's no failure email. If a step still fails after its retries, the whole run fails with that step's error and shows red in the console: Step Functions → the state machine → Executions → the failed run → the red step → its error and cause. Check this after each Monday run, or look at `/api/health`, whose `wildfireModel` week stops advancing when runs fail. The site keeps using the last good week until it's 13 days old, so a missed week isn't urgent.

## The state machine's role

Step Functions → Create state machine → paste the JSON → let it create a role. It needs only one permission:

| Permission | On | Why |
|---|---|---|
| `lambda:InvokeFunction` | The three wildfire Lambdas (`arn:aws:lambda:<region>:<account>:function:wildfire-*`) | To run each step |

The console reads the Lambda names from the definition and usually adds this for you. Check the role afterwards. If it's missing, a run fails at the first step with `AccessDenied`.

**Logging:** in the state machine's settings, set logging to **ERROR** (just failures) and send it to a log group, then set that log group's retention to 30 days (08). **ALL** logs every step's input and output, which is useful while building but noisy afterwards.

## The weekly schedule

EventBridge → Scheduler → Create schedule:

1. **Name:** `wildfire-weekly`.
2. **Recurring → Cron-based:** `0 6 ? * MON *`, time zone **UTC**. That's Mondays at 06:00 UTC, the start of the week the model scores, off-peak for NASA and Open-Meteo, and late Sunday night in the US, before the site's busiest hours.
   (The six fields are minute, hour, day-of-month, month, day-of-week, year. `?` means "any" for day-of-month, because you're setting day-of-week instead.)
3. **Flexible time window:** off.
4. **Target:** AWS Step Functions **StartExecution** → `wildfire-weekly` state machine.
5. **Input:**

   ```json
   { "chunks": [0, 1, 2, 3, 4, 5, 6, 7] }
   ```

6. **Retry policy:** maximum event age **1 hour**, retries **2**. That retries starting the run, not the steps inside it.
7. **Permissions:** let it create a role (it only needs `states:StartExecution` on this state machine).

**Running it by hand** (for testing, or to redo a week): Step Functions → the state machine → Start execution → the same input. A run started on a Wednesday still scores that week's Monday, because each step works the week out from the start time.

**Don't let two runs overlap.** A weekly run takes about 45 minutes, so overlap only happens if you start one by hand during a scheduled run. Before starting one by hand, check the state machine's executions list for one already running. Two at once would double the request rate to NASA POWER, causing 429s. The `Throttled` retries would mostly absorb those, but it's slower and messier.
