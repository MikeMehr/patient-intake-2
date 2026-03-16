import Link from "next/link";
import Logo from "@/app/marketing/components/Logo";

export const metadata = {
  title: "Privacy Policy — Health Assist AI",
  description: "Health Assist AI Privacy Policy — how we collect, use, and protect your information.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200 px-6 py-4" style={{ backgroundColor: "rgb(18, 39, 192)" }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/marketing">
            <Logo />
          </Link>
          <nav className="flex gap-6 text-sm text-white/80">
            <Link href="/terms" className="hover:text-white transition-colors">Terms of Use</Link>
            <Link href="/compliance" className="hover:text-white transition-colors">Compliance</Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-sm text-gray-500 mb-2">Effective: February 24, 2026 &nbsp;|&nbsp; Last updated: March 2026</p>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-gray-600 mb-10">
          This Privacy Policy describes how Health Assist AI (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;Provider&rdquo;)
          collects, uses, discloses, and protects information in connection with our AI-enabled clinical documentation
          and patient intake platform. Questions? Contact us at{" "}
          <a href="mailto:info@health-assist.org" className="text-blue-600 underline">info@health-assist.org</a>.
        </p>

        <Section title="1. Overview">
          <P>Health Assist AI provides an AI-enabled clinical documentation and patient intake platform used by healthcare organizations (&ldquo;Customers&rdquo;). We are committed to the privacy, confidentiality, and security of all information processed through our platform.</P>
        </Section>

        <Section title="2. Definitions">
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li><strong>Personal Information:</strong> Any information about an identifiable individual.</li>
            <li><strong>PHI (Protected Health Information / Personal Health Information):</strong> Personal information relating to an individual&rsquo;s health, collected in the course of providing healthcare services.</li>
            <li><strong>Customer Data:</strong> All data submitted to the platform by a Customer or its patients.</li>
            <li><strong>Controller / Organization:</strong> The healthcare organization that determines the purposes and means of processing personal information.</li>
            <li><strong>Processor / Service Provider:</strong> Health Assist AI, which processes personal information on behalf of the Controller.</li>
          </ul>
        </Section>

        <Section title="3. Our Role: Service Provider / Data Processor">
          <P>Health Assist AI acts as a <strong>service provider (data processor)</strong> on behalf of healthcare organizations. The healthcare organization — not Health Assist AI — determines what patient information is collected, for what purposes, and for how long it is retained. We process information only on the documented instructions of our Customers.</P>
        </Section>

        <Section title="4. Information We Collect">
          <P><strong>Account &amp; Organization Information:</strong> Names, email addresses, job titles, and credentials of authorized platform users.</P>
          <P><strong>Usage &amp; Technical Data:</strong> IP addresses, access logs, device type, and anonymized analytics used for platform security and performance. PHI is excluded from logs and analytics.</P>
          <P><strong>Patient Information:</strong> Chief complaint, medical history, medications, allergies, family history, and optional voice recordings submitted by or on behalf of patients through the intake workflow. This information is submitted by the healthcare organization or its patients, not collected independently by Health Assist AI.</P>
        </Section>

        <Section title="5. How Information Is Used">
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Operating the platform and delivering AI-assisted documentation features</li>
            <li>Generating draft clinical intake summaries for physician review</li>
            <li>Maintaining platform security, authentication, and audit trails</li>
            <li>Providing customer support and resolving issues</li>
            <li>Complying with applicable laws and regulations</li>
          </ul>
          <P className="mt-3"><strong>We do not sell personal information or patient data.</strong> We do not use patient PHI to train public AI models.</P>
        </Section>

        <Section title="6. Legal Bases for Processing">
          <P>We process personal information on the basis of: (a) contract performance — to deliver the services our Customers have engaged us to provide; (b) legal compliance — where applicable law requires; and (c) legitimate interests — for platform security and fraud prevention. Where required by applicable law (including BC PIPA and PIPEDA), processing of patient health information occurs on the basis of the patient&rsquo;s express consent, obtained by the healthcare organization.</P>
        </Section>

        <Section title="7. AI Processing &amp; Automation">
          <P>Our AI assists with structuring and summarizing patient-reported information and generating draft clinical notes. <strong>All AI-generated content is reviewed and approved by the responsible healthcare professional before any clinical use.</strong> Clinical decisions remain solely with providers. Patient data is not used to train public or shared AI models.</P>
        </Section>

        <Section title="8. Healthcare Compliance">
          <P>Health Assist AI aligns its practices with applicable healthcare privacy legislation, including:</P>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li><strong>BC PIPA</strong> (BC&rsquo;s <em>Personal Information Protection Act</em>) — the primary framework for private community clinics and physician offices in British Columbia.</li>
            <li><strong>PIPEDA</strong> (federal <em>Personal Information Protection and Electronic Documents Act</em>) — applies to federally regulated organizations and cross-border transfers.</li>
            <li><strong>PHIPA</strong> (Ontario&rsquo;s <em>Personal Health Information Protection Act</em>) — for Ontario-based healthcare organizations.</li>
            <li><strong>HIPAA / HITECH</strong> (United States) — where applicable. We operate as a HIPAA Business Associate and execute Business Associate Agreements with US Customers.</li>
          </ul>
          <P>We act as a <em>service provider</em> under BC PIPA and PIPEDA, and as a <em>data processor</em> under GDPR. Healthcare organizations retain accountability for their patients&rsquo; personal health information.</P>
        </Section>

        <Section title="9. Data Security Safeguards">
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Encryption of PHI in transit (TLS 1.2+) and at rest (AES-256)</li>
            <li>Role-based access controls and multi-factor authentication</li>
            <li>Comprehensive audit logging of all PHI access events</li>
            <li>Network segmentation and private endpoints; no public database exposure</li>
            <li>PHI excluded from application logs, error reporting, and analytics</li>
          </ul>
        </Section>

        <Section title="10. Sub-Processors &amp; Service Providers">
          <P>We use the following sub-processors to deliver the platform. All are bound by contractual obligations that require protection of personal information at a standard comparable to applicable law:</P>
          <table className="w-full text-sm border-collapse mt-3 mb-2">
            <thead>
              <tr className="bg-blue-50">
                <th className="text-left border border-gray-200 px-3 py-2">Sub-Processor</th>
                <th className="text-left border border-gray-200 px-3 py-2">Purpose</th>
                <th className="text-left border border-gray-200 px-3 py-2">Location</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-200 px-3 py-2">Microsoft Azure</td>
                <td className="border border-gray-200 px-3 py-2">App infrastructure, database, networking</td>
                <td className="border border-gray-200 px-3 py-2">Canada Central</td>
              </tr>
              <tr className="bg-gray-50">
                <td className="border border-gray-200 px-3 py-2">Microsoft Azure OpenAI</td>
                <td className="border border-gray-200 px-3 py-2">AI processing (GPT-4o)</td>
                <td className="border border-gray-200 px-3 py-2">East US 2 (USA) — see §14</td>
              </tr>
              <tr>
                <td className="border border-gray-200 px-3 py-2">Microsoft Azure Cognitive Services</td>
                <td className="border border-gray-200 px-3 py-2">Speech-to-text / text-to-speech</td>
                <td className="border border-gray-200 px-3 py-2">East US 2 (USA) — see §14</td>
              </tr>
              <tr className="bg-gray-50">
                <td className="border border-gray-200 px-3 py-2">Resend</td>
                <td className="border border-gray-200 px-3 py-2">Transactional email (OTP, invitations)</td>
                <td className="border border-gray-200 px-3 py-2">No PHI in email body</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section title="11. Data Retention">
          <P><strong>Patient session PHI</strong> is automatically and permanently deleted at the end of the configured retention window. The default retention window is <strong>3 years</strong> from session creation. Healthcare organizations may configure a longer window (up to 7 years) through their account settings. On-demand deletion is available at any time through the platform dashboard.</P>
          <P><strong>Consent records and audit logs</strong> are retained for 7 years as required by applicable healthcare privacy legislation.</P>
          <P><strong>Account information</strong> is retained for the duration of the Customer relationship and deleted within 30 days of account termination, except where retention is required by law.</P>
        </Section>

        <Section title="12. Individual Rights &amp; Access Requests">
          <P>Individuals have rights under applicable law including the right to access, correct, and request deletion of their personal information. Because Health Assist AI acts as a service provider to healthcare organizations, requests relating to patient health information should be directed to the healthcare organization (your clinic or physician). We will cooperate with Customers in responding to such requests.</P>
          <P>For inquiries about account or contact information held by Health Assist AI directly, contact us at <a href="mailto:info@health-assist.org" className="text-blue-600 underline">info@health-assist.org</a>.</P>
        </Section>

        <Section title="13. Breach Notification">
          <P>In the event of an actual or reasonably suspected breach involving Customer PHI, we will notify the affected Customer within <strong>48 hours</strong> of becoming aware of the incident, and will provide reasonable assistance to support the Customer&rsquo;s own regulatory notification obligations.</P>
        </Section>

        <Section title="14. International Data Processing &amp; Cross-Border Transfers">
          <P>Our application infrastructure (App Service, database, networking) is hosted in <strong>Microsoft Azure&rsquo;s Canada Central region</strong>. However, AI processing (Azure OpenAI, GPT-4o) and speech services (Azure Cognitive Services) are operated in Microsoft&rsquo;s <strong>East US 2 region in the United States</strong>.</P>
          <P>This means that patient health information submitted through the platform is <strong>transferred to and processed in the United States</strong> when AI or speech features are used.</P>
          <P><strong>Contractual Safeguards:</strong> We have in place with Microsoft Corporation: (a) a Data Processing Agreement (DPA) governing Microsoft&rsquo;s handling of personal information as a sub-processor; and (b) a HIPAA Business Associate Agreement (BAA). These agreements require Microsoft to implement safeguards comparable to those required under BC PIPA, PIPEDA, and HIPAA, and restrict Microsoft from using data for any purpose other than delivering the contracted services.</P>
          <P><strong>Transparency:</strong> As required by the federal Office of the Privacy Commissioner (OPC) cross-border transfer guidelines and by BC PIPA, we are transparent that information may be processed in a foreign jurisdiction and may be accessible by courts, law enforcement, or national security authorities under the laws of that jurisdiction (in this case, US law).</P>
          <P><strong>Healthcare organization responsibility:</strong> Private clinics and physician offices in BC using this platform remain accountable under BC PIPA for their patients&rsquo; personal health information even when transferred to a third party for processing. Clinics should ensure their own patient-facing privacy policy discloses that information may be transferred to and processed in the United States. Health Assist AI can provide copies of the applicable Microsoft DPA and BAA upon written request to support Privacy Impact Assessment documentation.</P>
        </Section>

        <Section title="15. Cookies &amp; Technical Tracking">
          <P>We use essential session cookies for authentication and security only. We do not use behavioral advertising cookies, third-party tracking pixels, or cross-site analytics.</P>
        </Section>

        <Section title="16. Children&rsquo;s Privacy">
          <P>The platform is designed for use by licensed healthcare professionals. We do not knowingly collect personal information from children except as part of an authorized patient intake workflow initiated by a healthcare provider.</P>
        </Section>

        <Section title="17. Policy Updates">
          <P>We may update this Privacy Policy periodically. We will notify Customers of material changes in advance by email or in-platform notice. Continued use of the platform after the effective date of an updated Policy constitutes acceptance of the changes.</P>
        </Section>

        <Section title="18. Contact &amp; Privacy Officer">
          <P>For privacy inquiries, data access requests, or to request copies of our Microsoft DPA and BAA:</P>
          <P><strong>Health Assist AI</strong><br />Privacy Officer<br /><a href="mailto:info@health-assist.org" className="text-blue-600 underline">info@health-assist.org</a></P>
        </Section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-12 py-8 text-center text-sm text-gray-500">
        <p>&copy; {new Date().getFullYear()} Health Assist AI. All rights reserved.</p>
        <div className="mt-2 flex justify-center gap-6">
          <Link href="/terms" className="hover:text-gray-700 underline">Terms of Use</Link>
          <Link href="/compliance" className="hover:text-gray-700 underline">Compliance</Link>
          <a href="mailto:info@health-assist.org" className="hover:text-gray-700 underline">Contact</a>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-3 pb-1 border-b border-gray-200">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function P({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-gray-700 leading-relaxed ${className}`}>{children}</p>;
}
