# 1. One-time setup

Do this once. Everything else builds on it.

## Pick a region

Use **us-west-2 (Oregon)** for everything in AWS: the bucket, the Lambdas, ECR, Step Functions and the schedules must all be in the same region, and the console only shows resources in the region selected at the top right. Supabase is in us-west-2, so the alert archive Lambda talks to it across the country (about 70 ms per round trip). That adds well under a second to a run, so it works fine; moving one of them is optional later.

In the console, the region picker is at the top right. Check it every time you create something: a resource made in the wrong region is invisible from the right one, which is the most common "where did my Lambda go?" moment.

## Don't use the root account day to day

The email you signed up with is the **root user**, which can do anything, including closing the account. Use it only to:

1. Turn on MFA for root (IAM → Security credentials).
2. Create an admin user for yourself: IAM → Users → Create user, attach the `AdministratorAccess` policy, and turn on MFA for it too.

Then sign in as that user from now on.

## IAM in one page

Two kinds of identities, used for different things:

| | IAM role | IAM user with access keys |
|---|---|---|
| For | AWS services acting on your behalf: a Lambda, a state machine, a scheduler | Things outside AWS: your laptop's CLI, Railway |
| How it gets credentials | AWS hands it temporary credentials automatically | You create an access key and paste it somewhere |
| Risk | Low: nothing to leak | Keys can leak. Give them the smallest possible permissions |

**Least privilege:** give each role or user only what it needs, on only the resources it needs. Each doc lists the exact permissions per piece. When the console offers to "create a new role with basic permissions", accept it, then add the extra permissions listed.

A policy is JSON like this. This one lets something read one file:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::riskresource-data/wildfire/latest.json" }
  ]
}
```

## Install the AWS CLI

You can do everything in the console, but a few steps (Docker image pushes, log retention in bulk) are much easier from the command line.

1. Install AWS CLI v2 from the AWS docs.
2. In IAM, create a separate user for the CLI, for example `local-dev-user`, with no console access. Give it only the policy below, so a leaked key can push images and update the wildfire functions but can't delete anything or run up a bill. Do everything else (creating roles, functions, schedules) in the console as your admin user.
3. On that user: Security credentials → Create access key → "Command Line Interface".
4. Run `aws configure` and paste the key, the secret, region `us-west-2` and output `json`.
5. Check: `aws sts get-caller-identity` prints your account ID and `local-dev-user`.

The CLI user's policy (IAM → Users → `local-dev-user` → Add permissions → Create inline policy → JSON). Replace `<account>` (12 digits) and `<bucket>`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrLogin",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "EcrPushWildfireImage",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:DescribeImages",
        "ecr:DescribeRepositories"
      ],
      "Resource": "arn:aws:ecr:us-west-2:<account>:repository/riskresource-wildfire"
    },
    {
      "Sid": "UpdateWildfireLambdas",
      "Effect": "Allow",
      "Action": ["lambda:UpdateFunctionCode", "lambda:GetFunction"],
      "Resource": "arn:aws:lambda:us-west-2:<account>:function:wildfire-*"
    },
    {
      "Sid": "SetLogRetention",
      "Effect": "Allow",
      "Action": ["logs:PutRetentionPolicy", "logs:DescribeLogGroups"],
      "Resource": "arn:aws:logs:us-west-2:<account>:log-group:*"
    },
    {
      "Sid": "UploadPublishedScores",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::<bucket>/wildfire/*"
    },
    {
      "Sid": "ListBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<bucket>"
    }
  ]
}
```

| Statement | Used by |
|---|---|
| `EcrLogin` | `aws ecr get-login-password` (04 step 5). It can't be limited to one repository, hence `*` |
| `EcrPushWildfireImage` | `docker push` (04 step 5). The two read actions let pushes skip layers ECR already has |
| `UpdateWildfireLambdas` | `aws lambda update-function-code` after a new image (04). Only the three `wildfire-*` functions |
| `SetLogRetention` | `aws logs put-retention-policy` (02, 08) |
| `UploadPublishedScores`, `ListBucket` | `aws s3 cp ... s3://<bucket>/wildfire/latest.json` (07), and `aws s3 ls` to check it |

`aws sts get-caller-identity` needs no permission.

## Create the S3 bucket

One bucket holds everything the wildfire pipeline produces.

1. S3 → Create bucket.
2. **Name:** globally unique, lowercase, for example `riskresource-data-<something>`.
3. **Region:** us-west-2.
4. **Block all public access:** leave it **on**. Nothing here should be public; the backend reads it with credentials.
5. **Bucket versioning:** on. If a bad run overwrites `latest.json`, you can restore the previous version.
6. **Default encryption:** leave the default (SSE-S3). It's free.

The folder layout the pipeline uses (S3 has no real folders; these are key prefixes):

```
raw/{week}/power_{start}_{end}/{cell}.parquet   Weather downloads. Delete after 14 days
features/{week}/features.csv        Model input, plus fips.json (the county for each row). Delete after 30 days
wildfire/latest.json                What the backend reads. Always the newest week
wildfire/weeks/{week}.json          A copy of every week. Keep 1 year
```

Retention rules for these prefixes are set up in [08](08-logs-retention-monitoring-costs.md).

## Store the database password safely

The alert Lambda needs `DATABASE_URL` (the Supabase connection string, which includes the password).

| Option | Cost | Effort |
|---|---|---|
| Lambda environment variable | Free | None. The code already reads it. AWS encrypts environment variables at rest, but anyone with console access to the function can see the value |
| SSM Parameter Store, SecureString | Free (standard tier) | A small code change to read it at startup, plus `ssm:GetParameter` and `kms:Decrypt` on the Lambda's role |
| Secrets Manager | $0.40/month per secret | Same as Parameter Store, plus automatic rotation, which Supabase doesn't support anyway |

**Recommendation:** an environment variable for now (only your team has console access). Move to Parameter Store later; it's free and keeps the password out of the Lambda's configuration page.

## A budget alarm

So a mistake can't quietly cost money.

1. Billing → Budgets → Create budget → **Monthly cost budget**.
2. Amount: **$5**. This whole setup should cost under $1 a month.
3. Alert at 80% of actual spend, emailed to you.
