#!/usr/bin/env python3
# build_sender_map.py — turn the observed inbox into an explicit sender map.
#
# Every address below was DECIDED, not matched. The groups carry the evidence
# that justified the decision, and a sender whose observed subjects did not all
# point the same way is deliberately absent: absent means unsorted, and unsorted
# means it stays in Roy's inbox. Never guess.
#
# CR AudioViz AI, LLC · EIN 39-3646201 · 2026-08-27

import json, sys
from pathlib import Path

GROUPS = [

 ("invite", "An affiliate or partner network telling us a merchant wants CR "
            "AudioViz in their program. These are inbound business offers, not "
            "notifications — every one is a merchant asking to be sold.",
  ["help@awin.com", "affiliates@andyanand.com", "affiliate@timekettle.co",
   "affiliates@omoshealthcare.com", "affiliates@squaremouth.com",
   "affiliates@dynadot.com", "imarku@imarku.net",
   "partners@wardrobesupplies.com", "zana.talijan@allinclusivemarketing.com",
   "ed@relyhome.com", "flaviar@afftraction.com", "lexi@adagio.com",
   "mia@jugbow.com", "jamie@jugbow.com", "letschat@partnerstack.com",
   "affiliates@elevenlabs.io", "imogen@elevenlabs.io",
   "hello@partnerstackmail.com", "partners@aff.mk2.viator.com",
   "hello@travelpayouts.com", "support@travelpayouts.com",
   "nora739109685@gmail.com", "zubar.vladyslav@gmail.com"]),

 ("action", "A human or a ticketing system continuing a conversation WE "
            "started. A vendor replying to our own ticket is the one category "
            "where filing it away costs money.",
  ["support@supabase.com", "app@base44.com", "app+canned.response@base44.com",
   "solutions-hub@impact.com", "support@cj.com",
   "booking_br.latam@cj.com", "partnersuccess@awin.com",
   "pubsupport@rakuten.com", "cloud-startup-support-bot@google.com",
   "cloudstartupsupport@google.com", "billing@zapier.com",
   "accounting@zapier.com", "support@twiliosendgrid.zendesk.com",
   "walkscore@redfin-help.zendesk.com", "fsdsupport@gsa.gov",
   "corphelp@dos.fl.gov", "ryans@assemblyai.com",
   "nickolas.murdakes@algolia.com", "edwin.martinez@netlify.com",
   "sabina.maliseva@discovercarhire.com", "charles.fernandes@c-openai.com",
   "assist@t.openai.com", "jamil.a@crawlbase.com", "bryan@neon.tech",
   "webmaster@floridarevenue.com", "myg2@account.g2.com",
   "security@getgitguardian.com",
   "failed-payments+acct_1qk05ld5kgnlq3da@stripe.com"]),

 ("notif", "Payment receipts, invoices and refund confirmations. Money that "
           "already moved: worth keeping, never worth interrupting for.",
  ["invoice+statements@vercel.com", "invoice+statements@supabase.com",
   "invoice+statements@render.com", "invoice+statements@replicate.com",
   "invoice+statements+acct_1epydaahwgq34jln@stripe.com",
   "invoice+statements+acct_1mteueaya3qpetab@stripe.com",
   "invoice+statements+acct_15ypnsjamnyvovfn@stripe.com",
   "invoice+statements+acct_1m07hslmdodimxbs@stripe.com",
   "invoice+statements+acct_1m2aunf3kn0lqxpp@stripe.com",
   "invoice+statements+acct_1m5es1anciss0kgj@stripe.com",
   "receipts+acct_1pksddhjohyvid2c@stripe.com", "receipts@openrouter.ai",
   "billing@webflow.com", "billing@replicate.email", "billing@tm1.openai.com",
   "workspace@google.com", "team@account.hostinger.com",
   "vydeaccounting@vyde.io"]),

 ("notif", "One-time codes, login alerts and account-change confirmations. "
           "Every one is stale by the time it is read.",
  ["no-response@cj.com", "mongodb-account@mongodb.com", "hey@posthog.com",
   "account@twitch.tv", "verify@x.com", "notify@updates.notion.so",
   "ko-fi@ko-fi.com", "accounts@dynadot.com", "accounts@firefox.com",
   "reply@getresponse.com", "memberservices@messages.rakuten.com",
   "microsoftaccount@emailnotifications.microsoft.com",
   "cloud-manager-support@mongodb.com", "a2p10dlc@twilio.com",
   "sns@synologynotification.com", "en@hostingerdomains.com",
   "delivery@unsplash.com", "feedback@rawg.io", "invitations@ravelry.com",
   "account@untappd.com", "robot2@openweathermap.org",
   "support@apilayer.com", "support@thenewsapi.com", "team@framer.com",
   "communications@heigit.org", "info@seatgeek.com",
   "microsoftexchange329e71ec88ae4615bbc36ab6ce41109e@craudiovizai.onmicrosoft.com"]),

 ("notif", "API keys, quotas, service status and platform change notices. "
           "Operational facts we act on from the dashboard, not the inbox.",
  ["support@rapidapi.com", "api@coingecko.com", "api@europeana.eu",
   "info@walkscore.com", "info@rescuegroups.org", "hello@newsdata.io",
   "support@tinify.com", "dms@airnowtech.org", "robot5@openweathermap.org",
   "api-management@graphhopper.com", "data-licensing@yelp.com",
   "info@uptimerobot.com", "product@netdata.cloud", "support@cloudinary.com",
   "support@supabase.io", "ant.wilson@supabase.com", "o365mc@microsoft.com",
   "info@groq.co", "developer@groq.co", "info@cerebras.net",
   "support@api.bible", "onedrive@infomail.microsoft.com"]),

 ("notif", "Vendor product marketing, onboarding drips, newsletters and event "
           "invitations. Every observed subject from these addresses is "
           "bulk-sent to a list.",
  ["hello@mercury.com", "the-messenger@mercury.com", "team@netlify.com",
   "technology@sba.gov", "reply@outreach.sba.gov", "welcome@openrouter.ai",
   "team@info.hostinger.com", "team@updates.hostinger.com",
   "community@getresponse.com", "e.email@dnb.com", "t.email@dnb.com",
   "hello@mk.ipinfo.io", "inceptionprogram@nvidia.com",
   "mongodb@team.mongodb.com", "team@voyage.mongodb.com",
   "team@elevenlabs.io", "contact@hello.webflow.com", "googlecloud@google.com",
   "googlecloudstartups@google.com", "googlemapsplatform@google.com",
   "hello@ko-fi.com", "support@buymeacoffee.com", "admin@akool.io", "admin@aiperfectvideo.com", "admin@perfectaivideo.com",
   "support@agent.ai", "derk@shotstack.io", "hello@mapbox.com",
   "info@akool.com", "hello@stackblitz.com", "hello@bolt.new",
   "ericsimons@bolt.new",
   "hello@roboflow.com", "growth@roboflow.com", "info@backblaze.com",
   "getstarted@backblaze.com", "joe@posthog.com", "team@base44.com",
   "welcome@supabase.com", "channing@indiehackers.com",
   "cory@info.synthesia.io", "devs@learn.deepgram.com",
   "ericsimons@stackblitz.com", "hey@jasper.ai", "broadcast@dealnotes.ai",
   "coteam@neon.tech", "brian.holt@neon.tech", "events@send.zapier.com",
   "learn@send.zapier.com", "hello@send.zapier.com", "hi@simple.ai",
   "info@builder.io", "hello@builder.io", "julia@hello.remove.bg",
   "rahul@imagekit.io", "skip@info.helloskip.com", "product@fireworks.ai",
   "inquiries@fireworks.ai", "team@m.ngrok.com", "pinbot@info.pinterest.com",
   "pinterest-recommendations@ideas.pinterest.com",
   "recommendations@discover.pinterest.com",
   "recommendations@explore.pinterest.com", "azure@promomail.microsoft.com",
   "azure@infoemails.microsoft.com", "aws-marketing-email-replies@amazon.com",
   "barrifn@amazon.com", "jomauricio@growth.stripe.com",
   "jomauricio@sales.stripe.com", "support@cohere.com",
   "support@info.printful.com", "support@trakt.tv", "support@twelvelabs.io",
   "team@comms.assemblyai.com", "hello@coingecko.com", "hello@fivetran.com",
   "help@data.world", "mail@spoonacular.com", "hello@alchemy.com",
   "hello@render.com", "dx@render.com", "hello@tailscale.com",
   "trial@tailscale.com", "em@em1.cloudflare.com",
   "hi@update.betterstack.com", "events@seatgeek.com",
   "communications@crossway.org", "hello@cio.discogs.com",
   "inaturalist@inaturalist.org", "ebird@birds.cornell.edu",
   "support@rebrickable.com", "synology@news.synology.com",
   "info@ses.uptimerobot.com", "announcements@figma.com",
   "product@engage.canva.com", "start@engage.canva.com",
   "product@getstream.io", "onboarding@algolia.com", "onboarding@hunter.io",
   "rotem@tavily.com", "zeno.rocha@resend.com", "zeno@updates.resend.com",
   "welcome@cerebras.net", "welcome-to-wix@emails.wix.com",
   "digital-cs@cloudinary.com", "support@wasabi.com", "support@cntnpath.com",
   "cindy@rentcast.io", "dcastro@yelp.com", "ccruz@digitalocean.com",
   "victor.erukhimov@avatarsdk.com", "twilio@qualtrics-survey.com",
   "teamtwilio@twilio.com", "alice@helloalice.com", "friends@unsplash.com",
   "pixabay@community.pixabay.com", "hello@api.video",
   "admin@info.smallbusinessdigitalready.verizon.com",
   "emails@emails.rakuten.com", "affiliate@discovercars.com",
   "email@tapt.viator.com", "booking@tapt.viator.com",
   "support@restoreroute.com", "onboarding@resend.dev"]),
]


def main():
    seen, entries = {}, []
    dupes = []
    for bucket, evidence, addrs in GROUPS:
        for a in addrs:
            a = a.lower().strip()
            if a.endswith("_marketing"):           # guard against my own typo
                continue
            if a in seen:
                dupes.append((a, seen[a], bucket))
                continue
            seen[a] = bucket
            entries.append({"address": a, "bucket": bucket, "evidence": evidence})

    if dupes:
        print("REFUSING TO WRITE — an address was decided twice:", file=sys.stderr)
        for a, first, second in dupes:
            print(f"  {a}: {first} then {second}", file=sys.stderr)
        return 1

    observed = {s["address"]: s["count"]
                for s in json.load(open("/home/claude/unsorted_senders.json"))["senders"]}
    covered = sum(observed.get(e["address"], 0) for e in entries)
    total = sum(observed.values())

    out = Path("/home/claude/ops/email-manager/lib/sender-map.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "_readme": [
            "Sender-level classification for the Javari Email Manager.",
            "",
            "WHY THIS EXISTS: 800 messages sat unsorted because keyword rules",
            "cannot read a sender. 'PersonalHour has invited you to join their",
            "program' carries no word RX_NOTIF or RX_ACTION was ever going to",
            "match. The fix is not a longer regex, it is knowing the sender.",
            "",
            "Every address here was decided by reading that sender's actual",
            "subject lines. A sender whose subjects pointed in more than one",
            "direction is DELIBERATELY ABSENT — absent means unsorted, and",
            "unsorted means it stays in the inbox. Never guess.",
            "",
            "Regenerate: python3 build_sender_map.py",
            "CR AudioViz AI, LLC - EIN 39-3646201",
        ],
        "generated": "2026-08-27",
        "senders_mapped": len(entries),
        "messages_covered": covered,
        "messages_observed": total,
        "senders": sorted(entries, key=lambda e: e["address"]),
    }, indent=1, ensure_ascii=False) + "\n")

    print(f"wrote {out}")
    print(f"  senders mapped : {len(entries)}")
    print(f"  covers         : {covered:,} of {total:,} observed messages "
          f"({100*covered/total:.0f}%)")
    from collections import Counter
    for b, n in Counter(e["bucket"] for e in entries).most_common():
        msgs = sum(observed.get(e['address'],0) for e in entries if e['bucket']==b)
        print(f"    {b:<8} {n:3} senders   {msgs:4} messages")
    left = total - covered
    print(f"  still unsorted : {left:,} messages across "
          f"{sum(1 for a in observed if a not in seen)} senders")
    return 0


if __name__ == "__main__":
    sys.exit(main())
