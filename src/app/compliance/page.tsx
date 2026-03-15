import Link from "next/link";
import Logo from "@/app/marketing/components/Logo";

export const metadata = {
  title: "Compliance & Data Protection — Health Assist AI",
  description: "Health Assist AI compliance with BC PIPA, PIPEDA, HIPAA, and GDPR — privacy frameworks, cross-border processing safeguards, and security measures.",
};

export default function CompliancePage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200 px-6 py-4" style={{ backgroundColor: "rgb(18, 39, 192)" }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/marketing">
            <Logo />
          </Link>
          <nav className="flex gap-6 text-sm text-white/80">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms of Use</Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-sm text-gray-500 mb-2">Last updated: March 2026</p>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Compliance &amp; Data Protection</h1>
        <p className="text-gray-600 mb-4">
          Health Assist AI is built on security-by-design and privacy-by-design principles. This page describes how
          our platform aligns with applicable privacy and data protection frameworks. It is provided for
          informational purposes only and <strong>does not constitute legal advice or certify compliance</strong> for
          any particular organization or use case.
        </p>
        <p className="text-gray-600 mb-10">
          Questions or requests for compliance documentation (DPA, BAA, PIA templates):{" "}
          <a href="mailto:info@health-assist.org" className="text-blue-600 underline">info@health-assist.org</a>
        </p>

        {/* BC PIPA */}
        <Section title="BC PIPA — British Columbia (Primary Framework for BC Private Clinics)">
          <Callout>
            This is the primary privacy framework for private community clinics and physician offices in British Columbia.
          </Callout>
          <P>BC&rsquo;s <em>Personal Information Protection Act</em> (PIPA) governs the collection, use, and disclosure of personal information by private-sector organizations in BC, including private medical clinics and physician offices.</P>
          <P><strong>Health Assist AI&rsquo;s role under BC PIPA:</strong> We act as a <em>service provider</em> — we process patient personal health information on behalf of the healthcare organization (the Controller). The healthcare organization retains accountability for its patients&rsquo; personal information under PIPA, including the requirement to obtain express patient consent before using an AI-assisted intake tool.</P>
          <P><strong>What Health Assist AI provides to support BC PIPA compliance:</strong></P>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Express consent collection at the point of patient intake (clinic-branded consent checkbox naming the clinic, the AI tool, cross-border processing, and retention period)</li>
            <li>Configurable PHI retention window — default <strong>12 hours</strong>, auto-deleted at expiry</li>
            <li>On-demand PHI deletion via the platform dashboard</li>
            <li>Audit logs of all PHI access and deletion events (retained 7 years)</li>
            <li>Breach notification to the healthcare organization within 48 hours</li>
            <li>Pre-filled Privacy Impact Assessment (PIA) template available on request</li>
            <li>Pilot Agreement including a service provider clause (PIPA s. 6 compatible)</li>
          </ul>
          <P><strong>Healthcare organization responsibilities under BC PIPA:</strong> Clinics must obtain express patient consent, document that consent in the patient&rsquo;s record, appoint a Privacy Contact, and ensure their own patient-facing privacy policy discloses that personal health information may be transferred to and processed in the United States. See <em>Cross-Border Processing</em> below.</P>
          <P><strong>Relevant guidance:</strong> Doctors of BC advises physicians in private practice to obtain informed patient consent for AI-assisted tools and to inform patients they can withdraw consent at any time without affecting care. CMPA guidance similarly recommends that patients be told the purpose of AI recording/transcription, the privacy and accuracy risks, and that the physician will review and edit the result.</P>
        </Section>

        {/* PIPEDA */}
        <Section title="PIPEDA — Canada (Federal)">
          <P>The federal <em>Personal Information Protection and Electronic Documents Act</em> (PIPEDA) applies to federally regulated organizations and governs cross-border transfers of personal information. Under PIPEDA, Canadian organizations are not prohibited from transferring personal information to another jurisdiction for processing, but they <strong>remain accountable</strong> and must use contractual or other means to ensure a comparable level of protection.</P>
          <P>The federal Office of the Privacy Commissioner (OPC) also requires that organizations be transparent that information may be processed in another jurisdiction and may be accessible there by courts, law enforcement, or national security authorities.</P>
          <P>Health Assist AI addresses these requirements through our Microsoft Data Processing Agreement (DPA) — see <em>Cross-Border Processing</em> below.</P>
        </Section>

        {/* Cross-Border Processing */}
        <Section title="Cross-Border Processing — Azure Infrastructure &amp; AI Services">
          <Callout type="info">
            Application infrastructure is hosted in Canada. AI and speech processing use Microsoft Azure services in the United States.
          </Callout>
          <table className="w-full text-sm border-collapse mt-3 mb-4">
            <thead>
              <tr className="bg-blue-50">
                <th className="text-left border border-gray-200 px-3 py-2">Service</th>
                <th className="text-left border border-gray-200 px-3 py-2">Purpose</th>
                <th className="text-left border border-gray-200 px-3 py-2">Region</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-200 px-3 py-2">Azure App Service &amp; Networking</td>
                <td className="border border-gray-200 px-3 py-2">Application hosting, VNet, private endpoints</td>
                <td className="border border-gray-200 px-3 py-2 font-medium text-green-700">Canada Central</td>
              </tr>
              <tr className="bg-gray-50">
                <td className="border border-gray-200 px-3 py-2">Azure SQL Database</td>
                <td className="border border-gray-200 px-3 py-2">Encrypted data storage</td>
                <td className="border border-gray-200 px-3 py-2 font-medium text-green-700">Canada Central</td>
              </tr>
              <tr>
                <td className="border border-gray-200 px-3 py-2">Azure OpenAI (GPT-4o)</td>
                <td className="border border-gray-200 px-3 py-2">AI processing, draft note generation</td>
                <td className="border border-gray-200 px-3 py-2 font-medium text-amber-700">East US 2 (USA)</td>
              </tr>
              <tr className="bg-gray-50">
                <td className="border border-gray-200 px-3 py-2">Azure Cognitive Services</td>
                <td className="border border-gray-200 px-3 py-2">Speech-to-text, text-to-speech</td>
                <td className="border border-gray-200 px-3 py-2 font-medium text-amber-700">East US 2 (USA)</td>
              </tr>
            </tbody>
          </table>
          <P><strong>Contractual safeguards:</strong> We have in place with Microsoft Corporation:</P>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>A <strong>Data Processing Agreement (DPA)</strong> requiring Microsoft to implement safeguards for personal information comparable to those required under BC PIPA and PIPEDA, and restricting use of data to delivering contracted services only.</li>
            <li>A <strong>HIPAA Business Associate Agreement (BAA)</strong> governing the handling of Protected Health Information in HIPAA-eligible Azure services.</li>
          </ul>
          <P>Healthcare organizations in BC may rely on these agreements as the contractual protection mechanism satisfying their accountability obligations under BC PIPA s. 6 and the OPC cross-border transfer framework. Copies of the DPA and BAA are available upon written request.</P>
          <P><strong>Disclosure to patients:</strong> Health Assist AI&rsquo;s patient intake consent form discloses that information will be processed on Microsoft Azure including servers in the USA. Healthcare organizations must also reflect this disclosure in their own clinic privacy policy.</P>
        </Section>

        {/* HIPAA */}
        <Section title="HIPAA / HITECH — United States">
          <P>For US-based healthcare organizations, Health Assist AI operates as a <strong>HIPAA Business Associate</strong>. We execute Business Associate Agreements (BAAs) with US Customers upon request.</P>
          <P>HIPAA safeguards implemented on the platform include:</P>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Encryption of PHI in transit (TLS 1.2+) and at rest (AES-256)</li>
            <li>Role-based access controls and mandatory multi-factor authentication</li>
            <li>PHI excluded from application logs, analytics, and error reporting</li>
            <li>Audit logs of all PHI access and deletion events</li>
            <li>PHI not used for public AI model training</li>
            <li>Breach notification procedures aligned with the HIPAA Breach Notification Rule</li>
          </ul>
          <P>Platform infrastructure runs on HIPAA-eligible Microsoft Azure services.</P>
        </Section>

        {/* PHIPA / Ontario */}
        <Section title="PHIPA — Ontario">
          <P>For Ontario-based healthcare organizations, Health Assist AI aligns with the <em>Personal Health Information Protection Act</em> (PHIPA). We act as a <em>service provider</em> under PHIPA, processing personal health information only on the instructions of the health information custodian (the healthcare organization). Data minimization, reasonable safeguards, and patient access rights are maintained consistent with PHIPA requirements.</P>
        </Section>

        {/* GDPR */}
        <Section title="GDPR — European Union">
          <P>For EU-based organizations, Health Assist AI functions as a <strong>Data Processor</strong>, with the Customer acting as Data Controller. We execute Data Processing Agreements (DPAs) with EU Customers upon request. We do not proactively market to or process personal data from EU residents outside of Customer-initiated workflows.</P>
        </Section>

        {/* Security */}
        <Section title="Security Safeguards">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
            {[
              ["Encryption", "TLS 1.2+ in transit, AES-256 at rest. Database connections require rejectUnauthorized=true."],
              ["Access Control", "Role-based permissions. Mandatory MFA for all admin and physician accounts."],
              ["Network Security", "Azure VNet with private endpoints. No public database exposure."],
              ["Audit Logging", "All PHI access, edit, and deletion events logged. Logs retained 7 years."],
              ["PHI Isolation", "PHI excluded from application logs, analytics, and error reporting pipelines."],
              ["Retention & Deletion", "PHI auto-deleted at configurable retention window (default: 12 hours). On-demand deletion available."],
            ].map(([title, desc]) => (
              <div key={title} className="border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
                <p className="text-sm text-gray-600">{desc}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Breach Response */}
        <Section title="Breach Response">
          <P>Health Assist AI maintains documented breach detection, investigation, and notification procedures aligned with BC PIPA, PIPEDA, and HIPAA requirements. In the event of an actual or suspected breach involving Customer PHI, we will:</P>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Notify the affected Customer within <strong>48 hours</strong> of becoming aware of the incident</li>
            <li>Provide a written summary of the nature and scope of the incident</li>
            <li>Cooperate with the Customer&rsquo;s own regulatory notification obligations</li>
            <li>Take immediate steps to contain and remediate the incident</li>
          </ul>
        </Section>

        {/* Agreements */}
        <Section title="Available Agreements &amp; Documentation">
          <table className="w-full text-sm border-collapse mt-2">
            <thead>
              <tr className="bg-blue-50">
                <th className="text-left border border-gray-200 px-3 py-2">Document</th>
                <th className="text-left border border-gray-200 px-3 py-2">Available To</th>
                <th className="text-left border border-gray-200 px-3 py-2">How to Request</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Microsoft Data Processing Agreement (DPA)", "All Customers", "Email info@health-assist.org"],
                ["Microsoft HIPAA Business Associate Agreement (BAA)", "All Customers", "Email info@health-assist.org"],
                ["Health Assist AI Service Provider Agreement (PIPA s. 6)", "BC / Canadian Customers", "Included in Pilot Agreement"],
                ["HIPAA Business Associate Agreement", "US Customers", "Email info@health-assist.org"],
                ["Pre-filled Privacy Impact Assessment (PIA) Template", "BC Customers", "Email info@health-assist.org"],
                ["GDPR Data Processing Agreement", "EU Customers", "Email info@health-assist.org"],
              ].map(([doc, audience, how], i) => (
                <tr key={doc} className={i % 2 === 1 ? "bg-gray-50" : ""}>
                  <td className="border border-gray-200 px-3 py-2">{doc}</td>
                  <td className="border border-gray-200 px-3 py-2 text-gray-600">{audience}</td>
                  <td className="border border-gray-200 px-3 py-2 text-gray-600">{how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500">
          <strong>Disclaimer:</strong> This page is provided for informational and transparency purposes only. It does not constitute legal advice and does not certify compliance with any specific regulatory framework for any particular organization or use case. Healthcare organizations should consult their own legal counsel regarding their specific privacy obligations.
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-12 py-8 text-center text-sm text-gray-500">
        <p>&copy; {new Date().getFullYear()} Health Assist AI. All rights reserved.</p>
        <div className="mt-2 flex justify-center gap-6">
          <Link href="/privacy" className="hover:text-gray-700 underline">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-gray-700 underline">Terms of Use</Link>
          <a href="mailto:info@health-assist.org" className="hover:text-gray-700 underline">Contact</a>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-gray-900 mb-3 pb-1 border-b border-gray-200">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function P({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-gray-700 leading-relaxed ${className}`}>{children}</p>;
}

function Callout({ children, type = "highlight" }: { children: React.ReactNode; type?: "highlight" | "info" }) {
  const styles = type === "info"
    ? "bg-amber-50 border-amber-300 text-amber-900"
    : "bg-blue-50 border-blue-300 text-blue-900";
  return (
    <div className={`border-l-4 px-4 py-2 rounded-r mb-3 text-sm font-medium ${styles}`}>
      {children}
    </div>
  );
}
