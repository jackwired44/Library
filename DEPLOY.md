# Putting The Wired CIO Vault live (like echo.wiredcio.com)

The repo is ready. These steps happen once, in Azure and GitHub. After that,
every push to the `scanner-platform-v29` branch updates the live site by
itself in about two minutes.

**What you end up with:** the Vault at its own address (for example
`vault.wiredcio.com`). Visitors must sign in with Microsoft, and only the
Wired CIO accounts you invite get in. The Vault's own sign-in still comes
after that.

---

## 1. Create the site in Azure (about 5 minutes)

1. Go to **portal.azure.com** and sign in with your Wired CIO account.
2. Click **Create a resource**, search **Static Web App**, click **Create**.
3. Fill in:
   - **Resource group**: pick the one Echo uses, or create `wiredcio-vault`.
   - **Name**: `wiredcio-vault`
   - **Plan type**: **Free**
   - **Deployment source**: **Other** (the repo already has its own deploy)
4. Click **Review + create**, then **Create**. Open the new resource when it finishes.

## 2. Connect GitHub to it

1. In the new Static Web App, on **Overview**, click **Manage deployment token** and copy the token.
2. Go to **github.com/jackwired44/Library**, then **Settings → Secrets and variables → Actions → New repository secret**.
   - **Name**: `AZURE_STATIC_WEB_APPS_API_TOKEN`
   - **Secret**: paste the token, then **Add secret**.
3. In GitHub, open **Actions → Deploy Vault → Run workflow**, choose branch
   `scanner-platform-v29`, and click **Run workflow**.
4. When it turns green, the site is live at the address shown on the Azure
   **Overview** page (it ends in `azurestaticapps.net`).

## 3. Give people access

Nobody can get in until they're invited.

1. In the Static Web App, open **Role management → Invite**.
2. Fill in:
   - **Authorization provider**: Azure Active Directory (Microsoft)
   - **Invitee details**: `jack@wiredcio.com`
   - **Role**: `vault` (type it exactly)
   - **Expiration**: as long as it allows
3. Click **Generate**, open the link it gives you, and sign in. That's you done.
4. Repeat for `carly@wiredcio.com`. The Free plan allows up to 25 people.

Anyone who signs in without an invite sees a "not on the Vault list" page.

## 4. Use a wiredcio.com address

1. In the Static Web App, open **Custom domains → Add → Custom domain on other DNS**.
2. Enter `vault.wiredcio.com`. Azure shows a **CNAME** value to add.
3. Whoever manages wiredcio.com's DNS (the same place `echo.wiredcio.com` was
   set up) adds a CNAME record: `vault` → the value Azure showed.
4. Back in Azure, click **Validate**. It issues the security certificate by
   itself, which can take up to an hour.

## 5. Bring your data over

Your leads live in your browser, tied to the address you use. The new site
starts empty.

1. On the link you use today, use **Backup everything** and save the file.
2. On the new site, use **Restore** and pick that file.

---

## What works on the new site

| Works | Needs claude.ai today |
|---|---|
| All three scanners, All leads, Refresher, Lists, Reps, History | Live Apollo pull, live checks, enrichment, website visits |
| Downloads, backup/restore, Diagnostics | "Ask for leads" read by Claude (the built-in reader still answers) |
| Importing an Apollo sync file | |

The Apollo items rely on your connected Apollo account inside claude.ai. To
get them on the new site too, the next step is a small server that holds
Wired CIO's Apollo API key (and a shared database, so Carly sees the same
leads). That is a separate decision.

## For whoever maintains this

- Deploy: `.github/workflows/deploy-vault.yml`. It publishes the committed
  bundle `wired-cio-lead-scanner-app.html` as `index.html`. With no token
  secret it does nothing and says so.
- Access rules: `deploy/staticwebapp.config.json`. Every page requires the
  invited `vault` role. GitHub and Twitter sign-in are switched off; only
  Microsoft is offered. Search engines are told not to index it.
- `deploy/403.html` is the page shown to a signed-in person who isn't invited.
