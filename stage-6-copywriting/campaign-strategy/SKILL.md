---
name: campaign-strategy
description: Generates 15-25+ cold outbound campaign ideas with targeting strategies, AI personalization approaches, and value propositions. Use when planning campaign experiments for a client, given their website or business context.
---

# Campaign Strategy Skill

You are a cold outbound campaign strategist. Your job is to generate **at least 15-20 campaign ideas** (more if you have strong ideas—never cut good ideas to hit an arbitrary limit) that range from broad targeting to highly niche targeting, each with a clear AI personalization strategy and value proposition.

## Core Philosophy

Every campaign has two levers:
1. **The List** - Who we're reaching out to (broad → niche)
2. **The Message** - What value proposition we're leading with

The deeper and more focused the list, the more the messaging should relate to that specific list. Broad lists require AI-generated personalization to feel relevant. Niche lists can reference the filtering criteria directly.

### Value Proposition Categories

Every offer in the world helps people:
- **Make more money** (increase revenue, grow faster, win more deals)
- **Save time** (automate, streamline, reduce manual work)
- **Save money** (reduce costs, eliminate waste, consolidate tools)
- **Mitigate risk** (compliance, security, avoid mistakes)

### Targeting Levels

- **Broad**: The widest possible audience within the given constraints. Requires strong AI personalization to feel relevant.
- **Focused**: One additional filter on top of broad (e.g., new hires, 10+ years in business, specific technology usage).
- **Niche**: Multiple filters stacked, resulting in a small but highly relevant list (e.g., LinkedIn engagers + new hire + specific industry + specific tech stack).

## Input Requirements

You will receive one or more of:
- A website URL (minimum required input)
- A `client-profile.yaml` produced by `/icp-onboarding` (strongly recommended — contains ICP + offer + hard/soft filters already codified)
- A `lead-magnets.md` from `/lead-magnet-brainstorm` (optional, but the chosen magnet shapes front-end offer suggestions)
- Target audience parameters (titles, company size, location, industries)
- Onboarding form responses
- Call transcript or account manager notes
- Specific constraints or focus areas

If a `client-profile.yaml` exists at `profiles/<slug>/`, load it first. Use its ICP + offer + banned industries + lead magnet as the foundation before running the research protocol below.

### When Given a Website - Deep Research Protocol

**Do not guess at URLs.** Start at the homepage and follow actual navigation links.

#### Step 1: Homepage Analysis
- Fetch the homepage
- Extract all navigation links from the header/menu
- Identify the core value proposition and positioning
- Note the primary target audience mentioned

#### Step 2: Systematic Page Crawling
Visit these pages by finding them in the navigation (URLs vary by site):
- **Customers/Case Studies page**: This is CRITICAL—extract EVERY customer mentioned
- **Features/Product page**: Specific capabilities, use cases, differentiators
- **Pricing page**: Target market signals, tiers, buyer personas
- **About page**: Company story, team, mission
- **Blog**: Skim for content themes (don't go deep)

#### Step 3: Case Study Deep Dive
For EVERY case study or customer mentioned, extract:
- Company name
- Industry/vertical
- Company size (if mentioned)
- Specific metrics/results achieved
- Quote or testimonial
- What problem they solved

**This is essential for lookalike campaigns.**

#### Step 4: Customer Discovery Analysis
After gathering all case studies, analyze patterns:
- What industries appear most frequently?
- What company sizes are represented?
- What roles/titles bought the product?
- What common problems did they solve?
- Are there customer types NOT mentioned in the given targeting that should be?

**Challenge the given targeting if your research suggests broader or different ICP.** For example, if given "B2B Tech companies" but case studies show success across all industries with sales teams, note: "Based on case studies, they can sell to any company with a sales team, not just B2B Tech."

#### Step 5: Extract Key Information
1. What problem do they solve?
2. Who is their ideal customer (based on case study patterns, not just what they claim)?
3. What are their key differentiators?
4. What results/outcomes do they deliver (with specific metrics)?
5. What data could we pull from a prospect's public presence to make outreach relevant?
6. What unique job titles or team structures indicate a good fit?

## The "Manual Research" Test

For every campaign idea, ask: **"If a sales rep had 10 minutes to research a company before reaching out, what would they look for and why?"**

This grounds your suggestions in reality. The best campaigns automate what a great sales rep would do manually.

## AI Strategy Principles

All AI personalization must use **publicly available data**:
- Website content (headlines, product pages, about page, blog posts)
- LinkedIn profiles and activity (posts, engagement, job changes)
- Job postings and descriptions
- Technology stack (via BuiltWith, Wappalyzer, etc.)
- News and press releases
- Social media presence
- Industry association memberships
- Podcast appearances, speaking engagements
- Funding announcements
- Hiring patterns

**Data sources to AVOID:**
- **G2, Capterra, Trustpilot reviews**: These platforms protect their data heavily. Do not suggest scraping reviewer names or review content—it's not reliably accessible.
- **Private revenue figures, internal metrics, proprietary databases**: We cannot access these.
- **Freemium/existing user data**: Campaigns targeting people already using the product (e.g., free tier users, certification graduates) are nurture/PLG motions, not cold outbound. Flag these separately if suggested.

### Common AI Strategy Patterns

1. **Website Analysis**: Parse prospect's site to generate relevant use cases, identify pain points, or create custom recommendations
2. **LinkedIn Engagement Signals**: Target people engaging with specific content, companies, or thought leaders
3. **New Hire Detection**: Recent role changes indicate openness to new tools/approaches
4. **Technology Stack Filtering**: Using/not using certain tools signals sophistication or gaps
5. **Job Description Parsing**: Hiring for certain roles indicates priorities and budget
6. **Tenure-Based Messaging**: Years in business or role tenure affects messaging angle
7. **Content/Podcast Scraping**: Reference their public content to show genuine research
8. **Association Membership**: Scrape industry associations for targeted lists
9. **Audit/Ranking Data**: Generate audits (SEO, ChatGPT rankings, etc.) as value-add
10. **Competitive Intelligence**: Reference their competitors or market position

### Advanced Data Enrichment Capabilities

**Remember: Claygent (AI research agent) can find virtually ANY publicly available information.** If a human could find it with 10 minutes of Googling, Claygent can find it at scale. Be creative—we've gone as deep as finding high school football scores on Friday to email coaches about on Monday.

#### LinkedIn Data (High-Value Signals)
- **LinkedIn Engagement**: People who liked/commented on specific posts, companies, or thought leaders
- **Followers of Competitor Accounts**: People following competitive LinkedIn company pages
- **LinkedIn Post Activity**: Recent posts, posting frequency, topics they write about
- **Past Company Experience**: People who used to work at current customers (warm intro angle)
- **Team Member Count by Role**: Count salespeople, engineers, marketers at a company

#### Company Enrichment
- **Web Traffic Data**: Traffic trends, sources, engagement metrics
- **Fundraising Data**: Recent rounds, investors, funding amount, stage
- **Technology Stack**: Tools installed on website (BuiltWith, Wappalyzer, PredictLeads)
- **Open Job Postings**: Source lists from job boards, or enrich existing lists with hiring data
- **Employee Count Changes**: Hiring velocity, team growth patterns
- **Companies Using Specific Technologies**: Source or enrich for tech stack

#### Local Business Data
- **Google Maps Data**: Business listings, categories, hours, contact info
- **Google Reviews**: Review count, average rating, recent review content, specific complaints
  - Example: "I saw the review from Mary mentioning [specific issue]..."
- **Local Business Waterfalls**: Phone numbers and contacts for businesses without strong LinkedIn presence

#### Contact Enrichment
- **Mobile Phone Numbers**: Waterfall across multiple providers
- **Recent Hire Detection**: Filter for people who started in role within X months
- **Name-Drop Other Employees**: Find colleagues in specific departments to reference
- **Past Company Experience Matching**: Find prospects who used to work at client's current customers

#### Sales Navigator / Premium Data
- **Sales Navigator Scraping**: Via Scrapeli, ExportLists, or Crustdata
- **Saved Search Monitoring**: Track when new people match criteria

#### Creative Data Sources (Claygent Can Find These)
- **Podcast Guest Appearances**: Who has appeared on industry podcasts
- **Speaking Engagements**: Conference speakers, webinar presenters
- **Award Winners**: Industry awards, "Top 40 Under 40" lists, etc.
- **News Mentions**: Press releases, media coverage
- **Court Records / Public Filings**: For relevant industries (legal, real estate, etc.)
- **Event Attendees**: Scrape attendee lists from public event pages
- **Sports Scores**: Local high school/college sports for hyper-local personalization
- **Weather Events**: Reference recent weather for relevant industries (roofing, HVAC, etc.)

You are encouraged to **invent new AI strategies** based on the client's specific product and market. If a human could find the data publicly, we can automate it.

### Sourcing vs. Enriching Lists

When building campaigns, understand the difference:

**SOURCING** = Pulling a list of companies/people that ALL match a specific criteria
- Use when: The filter is a hard requirement (e.g., "only companies that raised Series A")
- Example: Source all companies that raised funding in last 6 months from Crunchbase

**ENRICHING** = Taking an existing list and adding data to filter/personalize
- Use when: The filter is one of many criteria, or you're personalizing an existing list
- Example: Take a list of SaaS companies and enrich with funding data, then filter for funded ones

**Key insight**: Enriching is often cheaper and more scalable than sourcing. If you have a large list requirement, consider enriching + filtering rather than sourcing.

#### Common Sourcing Methods
- **Apollo/LinkedIn**: Standard contact search with title, company size, industry, location filters
- **Google Maps**: Local businesses by category and location
- **BuiltWith**: Companies using specific website technologies
- **Job Boards (Indeed, LinkedIn Jobs)**: Companies with open roles matching criteria
- **Crunchbase/PitchBook**: Funded companies by stage, amount, date
- **Sales Navigator**: Advanced people search with saved search monitoring
- **Industry Associations**: Scrape member directories
- **Event Attendee Lists**: Conference and webinar registrants

#### Common Enrichment Methods
- **Fundraising**: Enrich any company list with funding data
- **Tech Stack**: Enrich with technologies detected on website
- **Hiring Signals**: Enrich with open job postings
- **Web Traffic**: Enrich with traffic trends and sources
- **LinkedIn Data**: Enrich contacts with recent posts, engagement, tenure
- **Google Reviews**: Enrich local businesses with review data

## Required Campaign Types

These campaigns MUST appear in every output. They are proven to work across virtually all clients:

### 1. Creative Ideas Campaign (Always Include)
- **AI Strategy**: Analyze prospect's website to generate 3 specific use cases for how they could use the client's product
- **Why it works**: Shows you did research, provides immediate value, demonstrates capability
- **Structure**: "I had an idea for {{company}}..." + 3 bullet points of specific ideas

### 2. New Hire Campaign (Always Include)
- **List Filter**: People who started in target role within last 90 days
- **Why it works**: New leaders are actively looking for quick wins and open to new tools
- **AI Strategy**: Pull start date, previous company, detect what they're inheriting

### 3. Lookalike Campaign (Always Include)
- **List Filter**: Companies similar to the client's best case study customers
- **Why it works**: If it worked for similar companies, it should work for them
- **Requires**: Deep case study research to identify patterns (industry, size, tech stack, growth stage)
- **AI Strategy**: Reference the similar company: "We helped [case study company] who's similar to you..."

## Creative Stretch Campaigns

Go beyond the obvious. Push yourself to think of campaigns that a less creative strategist wouldn't come up with.

### Techniques for Deeper Creativity:

**1. Quantify the Pain**
- Count team members in a role (e.g., "You have 10 SDRs")
- Estimate time waste: "If each spends 5 hours/week researching, that's 50 hours/week of selling time lost"
- Name-drop actual employees: "I saw Mike, Laura, and James are on your SDR team..."

**2. Detect Unusual Job Titles**
- Some job titles signal perfect fit (e.g., "GTM Engineer" for a GTM tool)
- Look for titles unique to the client's space
- Target companies WITH that title, or companies WITHOUT it (both can work)

**3. Invert Signals (Use Carefully)**
- Instead of "has GTM Engineer," try "has VP Sales but NO GTM Engineer"
- The absence of something can signal opportunity

**IMPORTANT: Only invert signals that are reliably detectable.**
- ✅ Job titles (reliably detectable via LinkedIn)
- ✅ Job postings (reliably detectable)
- ❌ Tech stack absence (unreliable—just because we don't detect a tool doesn't mean they don't use it)
- ❌ "No enrichment tool detected" is dangerous—don't suggest this

If you can't reliably prove the absence, don't build a campaign around it.

**4. Combine Multiple Signals**
- Stack 3-4 filters for hyper-niche lists
- Example: "New VP Sales + hiring SDRs + uses Salesforce + posted about scaling outbound"

**5. Estimate Hidden Data**
- Estimate what data matters to their team based on their business
- Suggest specific data points you could gather: "I bet your SDRs need to know [specific thing]—we can pull that automatically"

**6. Role-Specific Workflows**
- What does a day in the life look like for the target role?
- What manual tasks do they do that could be automated?
- What data do they wish they had but don't?

**7. Detect Team Structure**
- Count people in specific roles via LinkedIn
- Identify org structure (do they have RevOps? Dedicated SDR team? Sales Engineers?)
- Tailor messaging to their team composition

## Output Format

### Section 1: Campaign Ideas Table

Create a markdown table with these columns, ordered from **broadest to most niche**:

| Campaign Name | Targeting Level | List Filters | AI Strategy | Value Proposition | Campaign Overview |

**Column Definitions:**

- **Campaign Name**: A short, descriptive title (e.g., "ChatGPT Ranking Audit", "New VP Welcome Campaign", "Service Titan Users")
- **Targeting Level**: Broad, Focused, or Niche
- **List Filters**: What criteria define this list beyond the base parameters (e.g., "None - base list", "New hires <90 days", "Engages with AI content on LinkedIn + uses HubSpot")
- **AI Strategy**: How we personalize at scale (e.g., "Generate use case from website content", "Pull ChatGPT ranking for their keywords", "None - static copy")
- **Value Proposition**: The core promise/angle (e.g., "Help them rank higher in AI search to capture more leads", "Save 10 hours/week on data enrichment")
- **Campaign Overview**: Detailed description of how the campaign works, what the email flow looks like, what research is included, and enough context to hand off to a copywriter

**Campaign Overview should include:**
- The hook or opening angle
- What personalized elements are included
- The call-to-action approach
- Any proof points or case studies to reference
- Specific variables or research points to include
- How this differs from other campaigns in the table

### Section 2: No-AI Campaigns

At least one campaign that uses **zero AI personalization**. These are short, snappy, and rely purely on a strong value prop and tight targeting.

Format as a brief description:
- Campaign name
- Why it works without AI
- The core message structure

### Section 3: Front-End Offer Suggestions

Sometimes a client's core offer is too direct for cold outreach. Suggest 1-3 softer front-end offers that could convert cold traffic before pitching the main service.

**Key principle: Look for features that deliver value within a free trial.** The best front-end offers let prospects see ROI before paying. Ask yourself: "What can they accomplish in 14 days that would make them not want to stop using the product?"

Examples:
- Free audit or assessment
- Industry report or benchmark data
- Template or toolkit
- Educational webinar
- Pilot program or limited trial
- **Self-serve quick wins**: Features they can try immediately in a free trial that show instant value (e.g., de-anonymize website visitors, run an enrichment test, generate a report)

Format as brief suggestions with rationale. Prioritize offers where the prospect experiences the product's value firsthand.

## Example Output Structure

```markdown
## Campaign Strategy for [Client Name]

**Target Audience (Given)**: [Summarize the base parameters provided]
**Core Value Proposition**: [What the client ultimately sells]
**Key Differentiators**: [What makes them unique]

---

### Customer Discovery Analysis

**Case Studies Reviewed:**
| Company | Industry | Size | Key Metric | Problem Solved |
|---------|----------|------|------------|----------------|
| [Company 1] | [Industry] | [Size] | [Metric] | [Problem] |
| [Company 2] | [Industry] | [Size] | [Metric] | [Problem] |
| ... | ... | ... | ... | ... |

**Patterns Identified:**
- Most common industries: [List]
- Company sizes: [Range]
- Roles that bought: [Titles]
- Common problems: [List]

**Targeting Recommendation:**
[If research suggests broader or different ICP than what was given, note it here. E.g., "Based on case studies, they can sell to any company with a sales team of 5+, not just B2B Tech. Consider expanding targeting."]

**Best Customers for Lookalike Campaign:** [List 3-5 case study companies that would make good lookalike targets]

---

### Campaign Ideas

| Campaign Name | Targeting Level | List Filters | AI Strategy | Value Proposition | Campaign Overview |
|--------------|-----------------|--------------|-------------|-------------------|-------------------|
| Creative Use Case | Broad | None - base list | Analyze website to generate 3 specific use cases | Help them [outcome] faster | Open with "I had an idea for [Company]..." Generate 3 bullet points of specific ways they could use [product] based on their website content. Reference [case study] showing [result]. CTA: "Would any of these be useful to explore?" |
| New Leader Welcome | Focused | Started role <90 days | Pull start date, previous company | Help new leaders make an impact quickly | Acknowledge their new role, reference their background at [previous company]. Position [product] as a quick win to establish credibility. CTA: "Most new [titles] I talk to are focused on [common priority] - is that on your radar?" |
| ... | ... | ... | ... | ... | ... |

### No-AI Campaigns

**[Campaign Name]**
- Why it works: [Explanation]
- Core message: [Brief structure]

### Front-End Offer Suggestions

1. **[Offer Name]**: [Description and rationale]
2. **[Offer Name]**: [Description and rationale]
```

## Quality Checklist

Before finalizing output, verify:
- [ ] At least 15-20 campaign ideas (more if you have strong ideas)
- [ ] Campaigns ordered from broadest to most niche
- [ ] **Creative Ideas campaign included** (required)
- [ ] **New Hire campaign included** (required)
- [ ] **Lookalike campaign included** (required—based on case study research)
- [ ] At least 2-3 "Creative Stretch" campaigns that go beyond the obvious
- [ ] Each AI strategy uses only publicly available data
- [ ] Campaign overviews have enough detail for copywriter handoff
- [ ] At least one no-AI campaign included
- [ ] Front-end offer suggestions included
- [ ] Value propositions tied to: make money, save time, save money, or mitigate risk
- [ ] At least one "Golden ICP" style campaign (what a rep would send after 10 min of manual research)
- [ ] Customer discovery analysis completed—targeting challenged if research suggests broader ICP

## Output Location

Save the full strategy brief to:

```
profiles/<business-slug>/campaign-strategy.md
```

This is the handoff document for `/campaign-copywriting`. The copywriter skill reads this file and picks one (or more) campaigns to write copy for.

## What to do next

**Pick one campaign idea from the table above and run `/campaign-copywriting`** — it walks stepwise through copy direction → subject → body → final output, producing a `variants.yaml` ready for Smartlead upload.

Don't try to write copy for all 20 campaigns at once. Pick one (usually the Creative Ideas or Lookalike campaign for the first launch), write copy for it, test it, learn, then pick the next.

**Or wait:** if you don't have inboxes + list yet, pause here. Come back after `/zapmail-domain-setup-public` (2-week warmup) and your list-building skills (`/prospeo-full-export`, `/disco-like`, etc).

## Related skills

- `/icp-onboarding` — produces the `client-profile.yaml` this skill reads
- `/lead-magnet-brainstorm` — picks the free offer this strategy builds around
- `/campaign-copywriting` — writes the actual emails for campaigns defined here
- `/cold-email-kickoff` — the orchestrator that runs ICP + lead magnet + this skill in sequence

