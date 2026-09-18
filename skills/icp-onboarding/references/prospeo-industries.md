# Prospeo Industry Taxonomy

Prospeo requires exact-match industry names. "Manufacturing" is NOT valid. "General Manufacturing" is. This file is the source of truth — pick industries from this list when writing `icp_hard_filters.industries_in` and `industries_out` in `client-profile.yaml`.

Source: https://prospeo.io/api-docs/enum/industries

---

## All valid industries (256 values)

- IT Services and IT Consulting
- Construction
- Business Consulting and Services
- General Retail
- Advertising Services
- Real Estate
- Software Development
- Medical Practices
- Financial Services
- Technology, Information and Internet
- Restaurants
- Hospitals and Health Care
- Wellness and Fitness Services
- Design Services
- Non-profit Organizations
- Individual and Family Services
- Hospitality
- Appliances, Electrical, and Electronics Manufacturing
- Motor Vehicle Manufacturing
- Professional Training and Coaching
- Food and Beverage Services
- Education Administration Programs
- Consumer Services
- Accounting
- General Wholesale
- Civic and Social Organizations
- Architecture and Planning
- Truck and Railroad Transportation
- Spectator Sports
- Entertainment Providers
- Retail Apparel and Fashion
- Higher Education
- Industrial Machinery Manufacturing
- Insurance
- Machinery Manufacturing
- Legal Services
- General Manufacturing
- Events Services
- Travel Arrangements
- Human Resources Services
- Law Practice
- Media Production and Publishing
- Food and Beverage Manufacturing
- Staffing and Recruiting
- Marketing Services
- Renewable Energy
- Research Services
- Facilities Services
- Environmental Services
- Telecommunications
- Transportation, Logistics, Supply Chain and Storage
- Electric Power Generation
- E-Learning Providers
- Oil, Gas, and Mining
- Arts and Crafts
- Photography
- Venture Capital and Private Equity Principals
- Music
- Retail Office Equipment
- Farming
- Wholesale Building Materials
- Furniture and Home Furnishings Manufacturing
- Government Administration
- Investment Management
- Civil Engineering
- Primary and Secondary Education
- Medical Equipment Manufacturing
- Textile Manufacturing
- Public Relations and Communications Services
- Printing Services
- Religious Institutions
- Artists and Writers
- Personal Care Product Manufacturing
- International Trade and Development
- Mental Health Care
- Chemical Manufacturing
- Pharmaceutical Manufacturing
- Utilities
- Information Services
- Security and Investigations
- Wholesale Import and Export
- Banking
- Biotechnology Research
- Recreational Facilities
- Automation Machinery Manufacturing
- Plastics Manufacturing
- Automotive
- Retail Groceries
- Freight and Package Transportation
- Computer and Network Security
- Computer Games
- Veterinary Services
- Airlines and Aviation
- Maritime Transportation
- Executive Offices
- Sporting Goods Manufacturing
- Market Research
- Mechanical or Industrial Engineering
- Aviation and Aerospace Component Manufacturing
- Strategic Management Services
- Consumer Goods
- Engineering Services
- Museums, Historical Sites, and Zoos
- Investment, Funds and Trusts
- Philanthropic Fundraising Services
- Human Resources
- Computer Hardware
- E-Learning
- Translation and Localization
- Public Safety
- Business Supplies and Equipment
- Defense and Space Manufacturing
- Glass, Ceramics and Concrete Manufacturing
- Warehousing and Storage
- Alternative Medicine
- Animation and Post-production
- Think Tanks
- Semiconductor Manufacturing
- Building Materials
- Capital Markets
- Interior Design
- Political Organizations
- Fundraising
- Law Enforcement
- Cosmetics
- Wireless Services
- Sports Teams and Clubs
- Retail Health and Personal Care Products
- Professional Services
- Social Networking Platforms
- Dairy Product Manufacturing
- Gambling Facilities and Casinos
- Internet Marketplace Platforms
- Shipbuilding
- Luxury Goods and Jewelry
- Libraries
- Ranching and Fisheries
- Online and Mail Order Retail
- Community Services
- Blockchain Services
- Food and Beverage Retail
- Retail Motor Vehicles
- Data Infrastructure and Analytics
- Wine and Spirits
- Sports and Recreation Instruction
- Paper and Forest Products
- Agriculture, Construction, Mining Machinery Manufacturing
- Home Health Care Services
- Vehicle Repair and Maintenance
- Business Content
- General Repair and Maintenance
- Maritime
- Packaging and Containers
- Industry Associations
- Retail Furniture and Home Furnishings
- Tobacco Manufacturing
- Pet Services
- Landscaping Services
- Alternative Dispute Resolution
- Dentists
- Wholesale Food and Beverage
- Fabricated Metal Products
- Aviation & Aerospace
- Railroad Equipment Manufacturing
- Mobile Gaming Apps
- Administrative and Support Services
- Apparel Manufacturing
- Nanotechnology Research
- Specialty Trade Contractors
- Janitorial Services
- Physical, Occupational and Speech Therapists
- Medical and Diagnostic Laboratories
- Professional Organizations
- Philanthropy
- Digital Accessibility Services
- Fashion Accessories Manufacturing
- Semiconductors
- Wholesale Motor Vehicles and Parts
- HVAC and Refrigeration Equipment Manufacturing
- Schools
- Wood Product Manufacturing
- Fire Protection
- Retail Office Supplies and Gifts
- Equipment Rental Services
- Movies, Videos and Sound
- Ground Passenger Transportation
- Wholesale Hardware, Plumbing, Heating Equipment
- Housing and Community Development
- Robotics Engineering
- Wholesale Chemical and Allied Products
- Building Finishing Contractors
- Child Day Care Services
- Radio and Television Broadcasting
- Paint, Coating, and Adhesive Manufacturing
- Building Structure and Exterior Contractors
- Retail Pharmacies
- Retail Building Materials and Garden Equipment
- Waste Treatment and Disposal
- Wholesale Machinery
- Metal Treatments
- Accommodation Services
- Horticulture
- Water Supply and Irrigation Systems
- Building Equipment Contractors
- Waste Collection
- Executive Search Services
- Telephone Call Centers
- Mobile Food Services
- Data Security Software Products
- Taxi and Limousine Services
- Retail Florists
- Metalworking Machinery Manufacturing
- Plastics and Rubber Product Manufacturing
- Climate Technology Product Manufacturing
- Golf Courses and Country Clubs
- Loan Brokers
- Water, Waste, Steam, and Air Conditioning Services
- Office Administration
- Wholesale Metals and Minerals
- Construction Hardware Manufacturing
- Surveying and Mapping Services
- Air, Water, and Waste Program Management
- Measuring and Control Instrument Manufacturing
- Leather Product Manufacturing
- Animal Feed Manufacturing
- Wholesale Furniture and Home Furnishings
- Wholesale Recyclable Materials
- Wholesale Drugs and Sundries
- Theater Companies
- Wholesale Apparel and Sewing Supplies
- Wholesale Computer Equipment
- Household, Laundry and Drycleaning Services
- Distilleries
- Breweries
- Wineries
- Optometrists
- Dance Companies
- Retail Recyclable Materials & Used Merchandise
- Utility System Construction
- Vocational Rehabilitation Services
- Amusement Parks and Arcades
- Retail Musical Instruments
- Turned Products and Fastener Manufacturing
- Engines and Power Transmission Equipment Manufacturing
- Transportation Equipment Manufacturing
- Collection Agencies
- Utilities Administration
- Credit Intermediation
- Housing and Socio-Economic Programs
- Securities and Commodity Exchanges
- Boilers, Tanks, and Shipping Container Manufacturing
- Claims Adjusting, Actuarial Services
- Ambulance Services
- Mattress and Blinds Manufacturing
- Regenerative Design
- Primary Metal Manufacturing

---

## Default exclusions

Unless the user explicitly targets these, exclude from every search:

- Religious Institutions
- Government Administration
- Political Organizations
- Non-profit Organizations
- Venture Capital and Private Equity Principals
- Civic and Social Organizations
- Law Enforcement
- Public Safety

(Low response rates, regulatory/PR risk, often not real buyers.)

---

## Seniority levels (for title filters)

Prospeo seniority values:

- Founder/Owner
- C-Suite
- Partner
- Vice President
- Head
- Director
- Manager
- Senior
- Entry
- Intern

---

## Common industry-name mistakes

| Wrong | Right |
|---|---|
| Manufacturing | General Manufacturing |
| Medical Devices | Medical Equipment Manufacturing |
| FinTech | Financial Services |
| Retail | General Retail |
| SaaS | Software Development OR Technology, Information and Internet |
| Healthcare | Hospitals and Health Care |
| Education | Primary and Secondary Education, Higher Education, or E-Learning |
| Tech | Software Development + Technology, Information and Internet + IT Services and IT Consulting |
| Logistics | Transportation, Logistics, Supply Chain and Storage |
| Biotech | Biotechnology Research |

If in doubt, grep this file for keywords.
