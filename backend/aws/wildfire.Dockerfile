# Container image for the weekly wildfire pipeline's Lambdas (aws/wildfire_steps.py).
#
# Build from backend/ (the context must include ml/ and weekly_scores/):
#   docker buildx build --platform linux/amd64 --provenance=false \
#       -f aws/wildfire.Dockerfile -t <account>.dkr.ecr.<region>.amazonaws.com/riskresource-wildfire:latest .
#
# One image serves all three functions. Each Lambda sets its own handler with
# "CMD override" in its image configuration:
#   wildfire_steps.fetch_chunk | wildfire_steps.build_features | wildfire_steps.calibrate_and_publish
#
# This file lives in aws/, not backend/, so Railway (which builds backend/) doesn't
# detect a Dockerfile and change how it deploys the API.

FROM public.ecr.aws/lambda/python:3.13

COPY aws/requirements-pipeline.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements-pipeline.txt

# The model code and its artifacts (~6 MB), the shared results format, and the handlers.
COPY ml/ ${LAMBDA_TASK_ROOT}/ml/
COPY weekly_scores/ ${LAMBDA_TASK_ROOT}/weekly_scores/
COPY aws/wildfire_steps.py ${LAMBDA_TASK_ROOT}/

CMD ["wildfire_steps.fetch_chunk"]
