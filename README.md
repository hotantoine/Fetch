# IG Fetch

IG Fetch is a small web tool for loading public Instagram profile media and downloading the items you select.

## Put It Online For Free

This copy is prepared for Render's free web-service hosting.

1. Upload this folder to a free GitHub repository.
2. Sign in to Render.
3. Choose **New** > **Blueprint**.
4. Connect the GitHub repository.
5. Render will read `render.yaml` and create a free web service named `ig-fetch`.
6. When the deploy finishes, open the `https://...onrender.com` URL on your iPad.

Render's free web services can go to sleep after a quiet period. The first visit after that can take about a minute to wake up.

## Make Instagram Fetching Work From Render

Instagram often blocks direct requests from free cloud servers. To make the hosted iPad version work, add a CreatorCrawl API key in Render:

1. Create a free CreatorCrawl account.
2. Copy your API key.
3. In Render, open the `ig-fetch` service.
4. Go to **Environment**.
5. Add `CREATORCRAWL_API_KEY` with your key as the value.
6. Save and redeploy.

CreatorCrawl offers free credits without a credit card. When the key is present, IG Fetch uses CreatorCrawl first and only falls back to direct Instagram fetching when no key is configured.
