# VTG CRM

Google Sheets (database) + Apps Script (API) + static pages on GitHub Pages.

- `apps-script/` – the API. Lives in Google; this copy is the backup. Paste into the Apps Script editor.
- `docs/` – the pages (GitHub Pages serves this folder).

**Do not commit** access codes, student/lead data, exports, or `.clasprc.json`. This repo is public-safe only if it holds code alone.

## One-time setup (sign in as the `vtg english` Google account)

1. Create a new Google Sheet (or copy your workbook first). Name it e.g. `VTG CRM`.
2. In the sheet: Extensions > Apps Script. Replace `Code.gs` with `apps-script/Code.gs`.
   Project Settings > tick "Show appsscript.json", then paste `apps-script/appsscript.json`.
3. Pick `setup` in the function dropdown, Run, approve permissions. It creates the `Leads`,
   `Follow-ups`, `Config` tabs and shows the **owner access code once**. Write it down.
4. Deploy > New deployment > Web app. Execute as: **Me**. Who has access: **Anyone**. Copy the `/exec` URL.
5. Put that URL in `docs/js/config.js` (`VTG_API_URL`).
6. Add TA / sales users: edit the three values in `addUser()`, run it, then change them back.
   Roles: `owner` (all), `ta` (leads + follow-ups + Today), `sales` (own leads only).

## Publish the pages

Repo Settings > Pages > Deploy from branch > `main` / `/docs`.
Site: `https://teachergiangvu.github.io/<repo>/login.html`

## Updating later

Apps Script: Deploy > Manage deployments > pencil > New version (keeps the same URL).
Copy the workbook before any structural change.

## Not done yet

- "Convert to student" only marks the lead Enrolled. Writing a row into `02_Hoc_vien` needs its exact headers.
- Check-in, Reports, Students view, Settings.
- Intake endpoint (`action: "intake"`) exists for the placement test / web forms but no form is wired yet.
