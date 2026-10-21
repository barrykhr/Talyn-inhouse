import json, random, csv, os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import docx
random.seed(42)
import pathlib
OUT=str(pathlib.Path(__file__).parent / "out")
os.makedirs(OUT, exist_ok=True)
ROLES=[
 dict(key="be",title="Senior Backend Engineer",dept="Engineering",loc="Bengaluru (hybrid)",
  req=["5+ years building backend services in Go or Java","PostgreSQL schema design and query tuning","Designing REST or gRPC APIs","Running services on AWS","On-call ownership of production systems"],
  pref=["Kafka or other event streaming","Kubernetes","Mentoring engineers"],
  skills=["Go","Java","PostgreSQL","gRPC","AWS","Kafka","Kubernetes","REST APIs"],
  titles=["Backend Engineer","Senior Software Engineer","Software Engineer II"], weak_titles=["QA Analyst","Support Engineer","Frontend Developer"]),
 dict(key="da",title="Data Analyst",dept="Analytics",loc="Mumbai",
  req=["3+ years of SQL for analysis","Building dashboards in Tableau or Power BI","Stakeholder reporting for business teams","Experimentation and A/B test analysis"],
  pref=["Python (pandas)","dbt","Product analytics tools such as Amplitude"],
  skills=["SQL","Tableau","Power BI","Python","pandas","dbt","A/B testing","Amplitude"],
  titles=["Data Analyst","Business Analyst","Analytics Associate"], weak_titles=["Accountant","Sales Coordinator","Content Writer"]),
 dict(key="pd",title="Product Designer",dept="Design",loc="Remote (India)",
  req=["4+ years designing web or mobile products","Figma prototyping","User research and usability testing","Design systems contribution"],
  pref=["B2B SaaS experience","Motion design","Accessibility (WCAG)"],
  skills=["Figma","Prototyping","User research","Usability testing","Design systems","WCAG","Motion design"],
  titles=["Product Designer","UX Designer","UI/UX Designer"], weak_titles=["Graphic Designer","Marketing Executive","Illustrator"]),
 dict(key="ae",title="Account Executive (Mid-Market)",dept="Sales",loc="Gurugram",
  req=["3+ years closing B2B SaaS deals","Owning a quota of $500k+ ARR","Running full sales cycles from discovery to close","CRM hygiene in Salesforce or HubSpot"],
  pref=["Selling to HR or finance buyers","MEDDICC or similar methodology"],
  skills=["B2B SaaS sales","Salesforce","HubSpot","MEDDICC","Negotiation","Pipeline management"],
  titles=["Account Executive","Senior Account Executive","Sales Manager"], weak_titles=["Retail Store Manager","Customer Support Agent","Inside Sales Intern"]),
 dict(key="cs",title="Customer Success Manager",dept="Customer Success",loc="Bengaluru",
  req=["3+ years managing a B2B customer portfolio","Driving renewals and expansion","Running onboarding for enterprise customers","Tracking health scores and churn risk"],
  pref=["Gainsight or ChurnZero","SQL basics"],
  skills=["Customer success","Renewals","Onboarding","Gainsight","ChurnZero","QBRs","SQL"],
  titles=["Customer Success Manager","Account Manager","Client Success Lead"], weak_titles=["Call Centre Executive","Hotel Front Office","Teacher"]),
 dict(key="sre",title="Site Reliability Engineer",dept="Engineering",loc="Hyderabad",
  req=["Kubernetes in production","Terraform infrastructure as code","Observability with Prometheus and Grafana","Incident response and postmortems","Linux systems administration"],
  pref=["Go or Python scripting","AWS or GCP certifications"],
  skills=["Kubernetes","Terraform","Prometheus","Grafana","Linux","AWS","GCP","Python","Go"],
  titles=["Site Reliability Engineer","DevOps Engineer","Platform Engineer"], weak_titles=["IT Helpdesk","Network Technician","Data Entry Operator"]),
 dict(key="pm",title="Product Manager",dept="Product",loc="Pune",
  req=["4+ years of product management for software products","Writing PRDs and prioritising roadmaps","Working with engineering and design squads","Defining and tracking product metrics"],
  pref=["HR-tech or B2B SaaS domain","SQL for self-serve analysis"],
  skills=["Product management","Roadmapping","PRDs","Product metrics","SQL","Jira","Discovery"],
  titles=["Product Manager","Senior Product Manager","Associate Product Manager"], weak_titles=["Project Coordinator","Operations Executive","Event Manager"]),
 dict(key="fin",title="FP&A Manager",dept="Finance",loc="Mumbai",
  req=["CA or MBA Finance qualification","5+ years in FP&A or corporate finance","Annual budgeting and rolling forecasts","Advanced Excel financial modelling"],
  pref=["SaaS metrics (ARR, NRR)","Anaplan or Adaptive Insights"],
  skills=["FP&A","Budgeting","Forecasting","Financial modelling","Excel","Anaplan","SaaS metrics"],
  titles=["FP&A Manager","Finance Manager","Senior Financial Analyst"], weak_titles=["Bank Teller","Billing Executive","Sales Associate"]),
 dict(key="hr",title="HR Business Partner",dept="People",loc="Chennai",
  req=["5+ years as an HR business partner","Performance management cycles","Employee relations case handling","Indian labour law knowledge"],
  pref=["HRIS such as Workday or Darwinbox","Org design"],
  skills=["HR business partnering","Performance management","Employee relations","Labour law","Workday","Darwinbox","Org design"],
  titles=["HR Business Partner","HR Manager","Senior HR Generalist"], weak_titles=["Recruitment Intern","Admin Executive","Payroll Clerk"]),
 dict(key="fe",title="Frontend Engineer (React)",dept="Engineering",loc="Remote (India)",
  req=["3+ years building production React applications","TypeScript","Web performance optimisation","Testing with Jest or Playwright"],
  pref=["Next.js","Accessibility (WCAG)","Design system components"],
  skills=["React","TypeScript","Next.js","Jest","Playwright","Web performance","WCAG"],
  titles=["Frontend Engineer","Software Engineer (Frontend)","UI Engineer"], weak_titles=["WordPress Developer","Java Developer","Technical Writer"]),
]
FIRST=["Aarav","Priya","Rohan","Ananya","Vikram","Sneha","Arjun","Kavya","Rahul","Meera","Siddharth","Isha","Karan","Divya","Aditya","Neha","Farhan","Zoya","Joseph","Lakshmi","Gurpreet","Tenzin","Imran","Pooja","Nikhil","Riya","Sanjay","Tanvi","Manoj","Fatima","Rajesh","Shreya","Abhishek","Nandini","Varun","Aisha","Harish","Deepa","Kunal","Sana","Omar","Elena","Daniel","Mei","Chen","Sofia","Liam","Amara","Kofi","Noor"]
LAST=["Sharma","Iyer","Patel","Reddy","Nair","Gupta","Khan","Singh","Menon","Das","Kulkarni","Bose","Rao","Joshi","Fernandes","Chatterjee","Mehta","Pillai","Verma","Hussain","Banerjee","D'Souza","Agarwal","Ghosh","Kapoor","Mishra","Thomas","Wong","Okafor","Garcia"]
COMPANIES=["Northwind Labs","Zentrix Software","Bluepeak Analytics","Orbital Pay","Kestrel Health","Tidewater Retail","Lumen Logistics","Arcadia Fintech","Cobalt Systems","Saffron Commerce","Halcyon Media","Vertex Learning"]
SCHOOLS=["IIT Madras","NIT Trichy","Delhi University","Anna University","BITS Pilani","Mumbai University","Christ University","IIM Indore","Pune University","VIT Vellore"]
used=set()
def name():
  while True:
    n=f"{random.choice(FIRST)} {random.choice(LAST)}"
    if n not in used: used.add(n); return n
def cv(person, role, tier):
  r=role; yrs={"strong":random.randint(6,10),"medium":random.randint(3,6),"weak":random.randint(1,4),"gap":random.randint(5,8),"conflict":random.randint(4,7)}.get(tier,3)
  title=person["title"]; comp=person["company"]
  lines=[person["name"],f"{title} · {comp} · {person['location']}",f"Email: {person['email']} · Phone: {person['phone']}","","SUMMARY"]
  if tier in("strong","gap","conflict"):
    lines.append(f"{title} with {yrs} years of experience. "+ "; ".join(r["req"][:3])+".")
  elif tier=="medium":
    lines.append(f"{title} with {yrs} years of experience in {r['dept'].lower()} teams.")
  else:
    lines.append(f"{title} with {yrs} years of experience, looking to move into {r['dept'].lower()}.")
  lines+=["","EXPERIENCE",f"{title}, {comp} ({2026-yrs+2}–present)"]
  reqs=r["req"]; skills=r["skills"]
  if tier=="strong":
    for q in reqs: lines.append(f"- {q}: delivered measurable outcomes, e.g. led a project that improved key metrics by {random.randint(15,60)}%.")
    for p in r["pref"][:2]: lines.append(f"- Hands-on with {p}.")
  elif tier in("gap","conflict"):
    for q in reqs[:-1]: lines.append(f"- {q}.")
  elif tier=="medium":
    for q in random.sample(reqs, k=max(1,len(reqs)//2)): lines.append(f"- Some exposure to {q.lower()}.")
  else:
    lines.append(f"- Day-to-day {title.lower()} responsibilities; supported cross-functional teams.")
  prev=random.choice([c for c in COMPANIES if c!=comp])
  lines+=[f"{random.choice(r['titles'] if tier!='weak' else r['weak_titles'])}, {prev} ({2026-yrs-3}–{2026-yrs+2})","- Collaborated with stakeholders and shipped quarterly goals."]
  if tier=="gap": lines+=["","CAREER BREAK (2021–2023)","- Took two years off for family caregiving; completed online courses during the break."]
  if tier=="conflict": lines+=["","NOTE","- Total experience: 2 years (see summary for full history)."]
  sk = skills if tier=="strong" else random.sample(skills,k=len(skills)//2) if tier in("medium","gap","conflict") else random.sample(["MS Office","Communication","Teamwork","Canva","Tally"],3)
  lines+=["","SKILLS",", ".join(sk),"","EDUCATION",f"B.Tech / B.Com / BA — {random.choice(SCHOOLS)} ({2026-yrs-7})"]
  return "\n".join(lines)
def pdf(path,text):
  c=canvas.Canvas(path,pagesize=A4); y=800
  for ln in text.split("\n"):
    c.drawString(40,y,ln[:110]); y-=14
    if y<40: c.showPage(); y=800
  c.save()
def dx(path,text):
  d=docx.Document()
  for ln in text.split("\n"): d.add_paragraph(ln)
  d.save(path)
manifest=[]
for ri,r in enumerate(ROLES):
  jd=f"{r['title']}\n\nTeam: {r['dept']} · Location: {r['loc']}\n\nAbout the role\nYou will join our {r['dept']} team to help us grow. You'll own outcomes end to end and work closely with cross-functional partners.\n\nResponsibilities\n- Deliver high-quality work for the {r['dept']} function\n- Partner with stakeholders across the company\n\nRequirements\n"+"\n".join("- "+x for x in r["req"])+"\n\nNice to have\n"+"\n".join("- "+x for x in r["pref"])+"\n\nSkills\n"+"\n".join("- "+x for x in r["skills"])+"\n"
  open(f"{OUT}/jd-{r['key']}.txt","w").write(jd)
  tiers=["strong"]*5+["medium"]*6+["weak"]*4+["gap","conflict"]+["sparse","nomaterial"]+["duplicate"]
  cands=[]
  for i,t in enumerate(tiers):
    nm=name(); first,last=nm.split(" ",1)
    title=random.choice(r["titles"] if t!="weak" else r["weak_titles"])
    p=dict(name=nm,email=f"{first.lower()}.{last.lower().replace(chr(39),'')}.{r['key']}{i}@example.com",phone=f"+91 9{random.randint(100000000,999999999)}",
      location=random.choice(["Bengaluru","Mumbai","Pune","Hyderabad","Chennai","Delhi NCR","Kochi"]),title=title,company=random.choice(COMPANIES),tier=t,role=r["key"],
      linkedin=f"https://www.linkedin.com/in/{first.lower()}-{last.lower().replace(chr(39),'')}-{random.randint(100,999)}")
    if t=="duplicate":
      # same person as candidate 0 of previous role (different email, same name+phone): tests duplicate review
      src=manifest[-1]["cands"][0] if manifest else None
      if src:
        p.update(name=src["name"],phone=src["phone"],email=src["email"].replace("@example.com","+alt@example.com"),title=src["title"],company=src["company"],location=src["location"]); used.add(src["name"])
      else: p["tier"]=t="medium"
    text = "" if t in("sparse","nomaterial") else cv(p,r,"strong" if t=="duplicate" else t)
    p["cvText"]=text
    p["fileType"]= "pdf" if i in(0,6,11) else "docx" if i in(1,7) else "csv"
    if t in("sparse","nomaterial"): p["fileType"]="none"
    if p["fileType"]=="pdf": pdf(f"{OUT}/cv-{r['key']}-{i}.pdf",text)
    if p["fileType"]=="docx": dx(f"{OUT}/cv-{r['key']}-{i}.docx",text)
    p["file"]= f"{OUT}/cv-{r['key']}-{i}.{p['fileType']}" if p["fileType"] in("pdf","docx") else None
    cands.append(p)
  with open(f"{OUT}/candidates-{r['key']}.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["Full name","Email","Phone","Location","Current title","Current company","LinkedIn URL","Candidate summary","Resume text"])
    for p in cands:
      if p["tier"]=="nomaterial": w.writerow([p["name"],p["email"],p["phone"],"","","","","",""]); continue
      summ = f"{p['title']} interested in the {r['title']} role." if p["tier"]=="sparse" else ""
      w.writerow([p["name"],p["email"],p["phone"],p["location"],p["title"] if p["tier"]!="nomaterial" else "",p["company"],p["linkedin"],summ, p["cvText"] if p["fileType"]=="csv" else ""])
  manifest.append(dict(role=r,jdFile=f"{OUT}/jd-{r['key']}.txt",csv=f"{OUT}/candidates-{r['key']}.csv",cands=cands))
json.dump(manifest,open(f"{OUT}/manifest.json","w"),indent=1)
print(sum(len(m["cands"]) for m in manifest),"candidates;", len([c for m in manifest for c in m["cands"] if c["file"]]),"CV files")
