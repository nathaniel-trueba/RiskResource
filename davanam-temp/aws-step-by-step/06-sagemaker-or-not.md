# 6. SageMaker: not used

**Decision:** the weekly wildfire pipeline doesn't use SageMaker. The model runs inside the last Lambda, `wildfire-calibrate-publish`. There's nothing to set up for this step.

## What SageMaker would have done

SageMaker Batch Transform takes a trained model and a file of rows, starts a machine, writes a prediction for every row to S3, and shuts down. In this pipeline it would have replaced only the "run the model" part of the last step.

## Why not

- **The inference is tiny.** 3,221 rows through XGBoost takes well under a second, inside a Lambda that's running anyway. Batch Transform would start a machine for several minutes to do that.
- **More things to break.** It needs a packaged model in S3, a SageMaker model resource, its own IAM role, extra state machine permissions, and a separate step to calibrate afterwards.
- **A version risk.** The model was saved with xgboost 3.4.1. SageMaker's built-in XGBoost containers lag behind new releases, and an older xgboost may not load the model, or may load it differently. Avoiding that would mean building and maintaining a custom container.
- **Time.** It's late in the project, and none of this changes the scores.

## What that means in practice

- **The state machine has three steps:** download weather, build features, calibrate and publish ([05](05-step-functions-and-scheduling.md)).
- **No `predictions/` folder in S3**, and no `models/` folder ([01](01-aws-basics-and-setup.md)).
- **About $0.10 a month cheaper** ([08](08-logs-retention-monitoring-costs.md)).

## If you add it later

The heavy work in this pipeline is the download step, not the model, so SageMaker only makes sense if the model gets much bigger or training moves to SageMaker too. Then it would be one extra state between `BuildFeatures` and `CalibrateAndPublish`, plus a way for the last Lambda to read SageMaker's output instead of running the model. The feature file is already headerless CSV in model column order, which is the format SageMaker's XGBoost container expects.
