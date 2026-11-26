# 5. The state machine and the weekly schedule

## What Step Functions needs from you

A **state machine** is a JSON document (in "Amazon States Language") listing the steps, what each one runs, and what happens on errors. You can draw it in the console's visual editor (Workflow Studio), which writes the JSON for you, or paste JSON in. Below is the full definition with every setting explained.

**Type: Standard**, not Express. Standard workflows can run for up to a year and can wait for a SageMaker job to finish (`.sync`). Express workflows are capped at 5 minutes. Standard costs $0.025 per 1,000 state transitions; a weekly run has about 30, so it's effectively free (4,000 free a month).

## The definition

Replace `<account>`, `<region>` and `<bucket>`. The SageMaker step assumes you went that way (06). The version without it follows.

```json
{
  "Comment": "Weekly wildfire scores: download, features, inference, publish",
  "StartAt": "DownloadWeather",
  "States": {
    "DownloadWeather": {
      "Type": "Map",
      "ItemsPath": "$.chunks",
      "ItemSelector": {
        "chunk.$": "$$.Map.Item.Value",
        "of": 8,
        "startTime.$": "$$.Execution.StartTime"
      },
      "MaxConcurrency": 1,
      "ItemProcessor": {
        "ProcessorConfig": { "Mode": "INLINE" },
        "StartAt": "FetchChunk",
        "States": {
          "FetchChunk": {
            "Type": "Task",
            "Resource": "arn:aws:states:::lambda:invoke",
            "Parameters": {
              "FunctionName": "wildfire-fetch-chunk",
              "Payload.$": "$"
            },
            "ResultSelector": { "cells.$": "$.Payload.cells" },
            "Retry": [
              {
                "ErrorEquals": ["Throttled"],
                "IntervalSeconds": 60,
                "BackoffRate": 2,
                "MaxAttempts": 5,
                "JitterStrategy": "FULL"
              },
              {
                "ErrorEquals": ["States.Timeout", "Lambda.ServiceException", "Lambda.TooManyRequestsException", "States.TaskFailed"],
                "IntervalSeconds": 30,
                "BackoffRate": 2,
                "MaxAttempts": 3
              }
            ],
            "End": true
          }
        }
      },
      "ResultPath": null,
      "Next": "BuildFeatures",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "NotifyFailure" }]
    },

    "BuildFeatures": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "wildfire-build-features",
        "Payload": { "startTime.$": "$$.Execution.StartTime" }
      },
      "ResultSelector": { "week.$": "$.Payload.week", "featuresUri.$": "$.Payload.featuresUri" },
      "ResultPath": "$.features",
      "Retry": [{ "ErrorEquals": ["States.ALL"], "IntervalSeconds": 120, "BackoffRate": 2, "MaxAttempts": 2 }],
      "Next": "Inference",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "NotifyFailure" }]
    },

    "Inference": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sagemaker:createTransformJob.sync",
      "Parameters": {
        "TransformJobName.$": "States.Format('wildfire-{}', $$.Execution.Name)",
        "ModelName": "wildfire-xgboost",
        "TransformInput": {
          "DataSource": { "S3DataSource": { "S3DataType": "S3Prefix", "S3Uri.$": "$.features.featuresUri" } },
          "ContentType": "text/csv",
          "SplitType": "Line"
        },
        "TransformOutput": {
          "S3OutputPath.$": "States.Format('s3://<bucket>/predictions/{}/', $.features.week)",
          "AssembleWith": "Line"
        },
        "TransformResources": { "InstanceType": "ml.m5.large", "InstanceCount": 1 }
      },
      "ResultPath": null,
      "Retry": [{ "ErrorEquals": ["States.ALL"], "IntervalSeconds": 300, "MaxAttempts": 1 }],
      "Next": "CalibrateAndPublish",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "NotifyFailure" }]
    },

    "CalibrateAndPublish": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "wildfire-calibrate-publish",
        "Payload": { "week.$": "$.features.week" }
      },
      "Retry": [{ "ErrorEquals": ["States.ALL"], "IntervalSeconds": 60, "BackoffRate": 2, "MaxAttempts": 3 }],
      "End": true,
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "NotifyFailure" }]
    },

    "NotifyFailure": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "arn:aws:sns:<region>:<account>:riskresource-alerts",
        "Subject": "Weekly wildfire scores failed",
        "Message.$": "States.Format('Execution {} failed: {}', $$.Execution.Name, States.JsonToString($.error))"
      },
      "Next": "Failed"
    },

    "Failed": { "Type": "Fail", "Error": "WeeklyRunFailed" }
  }
}
```

### Each part, in plain terms

**`DownloadWeather` (Map).** Runs `FetchChunk` once per item in `$.chunks`, the list `[0,1,2,3,4,5,6,7]` passed in by the schedule.

- `ItemSelector` builds each chunk's input: its number, the total (8), and the run's start time, from which the Lambda works out the week.
- **`MaxConcurrency: 1`** is the rate limiter: one chunk at a time, 60 requests a minute overall. Only raise it to 2 if you've seen POWER tolerate ~120 a minute.
- `ResultPath: null` throws away the chunks' outputs so they don't bloat the next step's input. Their real output is the files in S3.

**`FetchChunk`'s `Retry`** is where rate limiting is handled:

- `Throttled` (raised by our code when POWER returns 429): wait 60 s, then 120, 240, 480, 960 (`BackoffRate: 2`, up to 5 attempts). `JitterStrategy: FULL` randomizes each wait a bit, so retries don't line up.
- Lambda's own hiccups and timeouts: retry 3 times starting at 30 s.
- Because downloads already in S3 are skipped, each retry only fetches what's missing.

**`BuildFeatures`.** One Lambda: the forecast plus features. It returns the week and where it wrote the CSV, saved under `$.features` for the next steps to use.

**`Inference` (SageMaker).** `createTransformJob.sync` starts a Batch Transform job, and **`.sync` makes Step Functions wait until the job finishes**, polling for you. Without `.sync` it would start the job and move straight on.

- `TransformJobName` must be unique per job, so it includes the execution name.
- `SplitType: Line` sends the CSV row by row. `AssembleWith: Line` writes one prediction per line, in the same order.

**`CalibrateAndPublish`.** Reads the predictions, calibrates, attaches county codes, writes `latest.json` and the weekly copy.

**`Catch` → `NotifyFailure`.** If any step fails after its retries, Step Functions emails the SNS topic, then marks the run failed (`Failed`), so it shows red in the console.

### Without SageMaker

Delete the `Inference` state, point `BuildFeatures`' `Next` at `CalibrateAndPublish`, and have `calibrate_and_publish` run the model itself (load `model.json`, `predict`, then calibrate). Everything else is identical.

## The state machine's role

Step Functions → Create state machine → paste the JSON → let it create a role, then add to that role:

| Permission | On | Why |
|---|---|---|
| `lambda:InvokeFunction` | The three wildfire Lambdas | To run each step |
| `sns:Publish` | `riskresource-alerts` | Failure emails |
| `sagemaker:CreateTransformJob`, `DescribeTransformJob`, `StopTransformJob` | `*` (transform jobs) | Only if using SageMaker |
| `events:PutTargets`, `events:PutRule`, `events:DescribeRule` | `arn:aws:events:<region>:<account>:rule/StepFunctionsGetEventsForSageMakerTransformJobsRule` | `.sync` uses this AWS-managed rule to hear when the job finishes |
| `iam:PassRole` | The SageMaker execution role (06) | To hand SageMaker its own role |

When the console builds the role from your definition, it usually adds most of these for you. Check the list anyway.

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

**Don't let two runs overlap.** A weekly run takes about 45 minutes, so overlap only happens if you start one by hand during a scheduled run. The reserved concurrency of 1 on `wildfire-fetch-chunk` (04) keeps the request rate safe even then. The second run's chunk Lambdas would just get throttled and retried.
