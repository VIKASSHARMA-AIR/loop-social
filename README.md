# Loop — social video MVP

Loop is a shared Expo app for web and Android. It uses Supabase Auth, Postgres, and Storage for accounts and content.

## Included

- Email sign-up and sign-in with confirmation email
- Responsive shared feed with photos and short video playback
- Media uploads to a private bucket; feed media uses short-lived signed URLs
- Captions, likes, comments, following, profiles, and people/post search
- Post reports and a moderator queue for approval, rejection, and report review
- A rewards screen that is visibly paused; there is no ad serving, coin earning, or payout code
- Row Level Security policies for user-owned writes and moderated content

## Connect Supabase

1. Create a Supabase project.
2. Copy `.env.example` to `.env` and fill in the Project URL and publishable key from the project Connect panel. Do not put a service-role key in the app.
3. Run `supabase/schema.sql` once in the Supabase SQL editor.
4. Create an account in Loop. To enable the review tools for your account, run the commented moderator update at the bottom of `schema.sql` with your username.
5. Install dependencies, then run `npm run web` for the browser or `npm run android` with an Android device/emulator available.

The Supabase project and credentials are not available in this workspace, so shared login and media only start working after you connect your own project.

## Free web hosting with GitHub Pages

GitHub Pages is free for a **public** repository. The published website is public too, so keep private keys and personal data out of the repository. A public `VIKASSHARMA-AIR/loop-social` repository has been created. The workflow in `.github/workflows/deploy-pages.yml` builds and deploys the web app whenever you push to `main`.

1. Upload/push the contents of this `loop-social` folder to the repository root.
2. In the repository, open **Settings → Pages** and set the source to **GitHub Actions**.
3. If you already connected Supabase, add repository **Variables** named `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` under **Settings → Secrets and variables → Actions → Variables**. These values are included in the public web app bundle; never use the Supabase service-role key here.
4. Push to `main` or run **Actions → Build and publish Loop on GitHub Pages → Run workflow**. The published URL appears in the deployment job, usually `https://VIKASSHARMA-AIR.github.io/loop-social/`.

If the variables are missing, the site still builds but shows the cloud setup screen and cannot sign in or share posts. GitHub Pages hosts only the web client; Supabase remains the cloud backend. Android builds are produced separately from this same source project.

## Before public launch

- Configure Auth email templates, redirect URLs, password recovery, rate limits, and project backups.
- Set up a real moderation process, report response times, community standards, and a way to remove accounts and their media.
- Decide a storage and video delivery budget; this MVP limits uploads to 100 MB and picked clips to 90 seconds. A production feed should transcode and deliver adaptive video.
- Review privacy, content, age, copyright, and app-store requirements for the countries where you launch.
- Do not promise users a share of ad revenue or rewards for ad views/clicks. Google prohibits AdMob ads in apps that promise payment or incentives for viewing/clicking ads. Rewarded-ad rewards, where eligible, must be non-transferable and usable within the publisher's app. The current build keeps rewarded ads disabled pending policy review.

## Rename the app

Change `expo.name`, `expo.slug`, and `android.package` in `app.json`, then update the visible `loop` label in `App.tsx`.

