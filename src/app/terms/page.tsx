import Link from "next/link";
import Logo from "@/app/marketing/components/Logo";

export const metadata = {
  title: "Terms of Use — Health Assist AI",
  description: "Health Assist AI Terms of Use — governing your access to and use of the platform.",
};

export default function TermsPage() {
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
            <Link href="/compliance" className="hover:text-white transition-colors">Compliance</Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-sm text-gray-500 mb-2">Effective: February 1, 2026 &nbsp;|&nbsp; Last updated: March 2026</p>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Use</h1>
        <p className="text-gray-600 mb-10">
          These Terms of Use (&ldquo;Terms&rdquo;) govern your access to and use of the Health Assist AI platform
          (&ldquo;Platform&rdquo;) operated by Health Assist AI (&ldquo;Provider,&rdquo; &ldquo;we,&rdquo; or
          &ldquo;us&rdquo;). By accessing or using the Platform, you agree to be bound by these Terms. If you do not
          agree, do not use the Platform. Questions? Contact us at{" "}
          <a href="mailto:info@health-assist.org" className="text-blue-600 underline">info@health-assist.org</a>.
        </p>

        <Section title="1. Eligibility and Authorized Use">
          <P>The Platform is designed for use by licensed healthcare professionals and personnel acting under appropriate supervision, who are legally capable of entering binding agreements. By using the Platform, you represent that you meet these requirements and that your use complies with all applicable laws and professional regulations, including those of your provincial licensing body.</P>
        </Section>

        <Section title="2. Nature of the Platform">
          <P>Health Assist AI is a <strong>clinical workflow and documentation support tool</strong>. It assists with patient information gathering and the preparation of draft clinical documentation. It is <strong>not a medical device</strong>, is not licensed as a medical device by Health Canada, and does not replace clinical training, professional judgment, or the physician-patient relationship.</P>
        </Section>

        <Section title="3. No Medical Advice">
          <P>The Platform does not provide medical advice, diagnosis, treatment recommendations, prescribing guidance, or emergency triage. <strong>All clinical decisions remain solely with the licensed healthcare professional.</strong> AI-generated content is a draft only and must be reviewed, edited, and approved by the responsible clinician before any clinical use.</P>
        </Section>

        <Section title="4. No Emergency Use">
          <P>The Platform is not designed or intended for use in medical emergencies. If a patient is experiencing a medical emergency, call 911 or direct the patient to the nearest emergency department immediately.</P>
        </Section>

        <Section title="5. No Patient–Provider Relationship with Health Assist AI">
          <P>Use of the Platform does not create a physician-patient relationship, fiduciary relationship, or any duty of care between Health Assist AI and any patient. The physician-patient relationship exists solely between the healthcare professional and their patient.</P>
        </Section>

        <Section title="6. AI-Generated Content and Limitations">
          <P>AI-generated outputs may be incomplete, inaccurate, or outdated. Users bear full professional and legal responsibility for reviewing, verifying, and approving all AI-generated content before relying on it for any clinical purpose. Health Assist AI makes no representation that AI outputs are clinically accurate or suitable for any particular patient or situation.</P>
        </Section>

        <Section title="7. User Responsibilities">
          <P>You agree to:</P>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Provide accurate information when setting up and using the Platform</li>
            <li>Comply with all applicable laws, professional regulations, and privacy legislation (including BC PIPA, PIPEDA, and any applicable provincial health information legislation)</li>
            <li>Obtain valid express consent from patients before initiating an AI-assisted intake session, in accordance with applicable privacy law and CMPA guidance</li>
            <li>Maintain the security of your account credentials and enable multi-factor authentication</li>
            <li>Exercise appropriate professional oversight over all AI-assisted content</li>
            <li>Ensure your clinic&rsquo;s patient-facing privacy policy discloses that information may be transferred to and processed in the United States (see our <Link href="/privacy#cross-border" className="text-blue-600 underline">Privacy Policy §14</Link>)</li>
          </ul>
        </Section>

        <Section title="8. Prohibited Conduct">
          <P>You must not:</P>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Use the Platform for any unlawful purpose or in violation of applicable professional regulations</li>
            <li>Input information that you are not authorized to process or that is unrelated to patient care</li>
            <li>Reverse engineer, decompile, or attempt to extract the source code or underlying models of the Platform</li>
            <li>Interfere with or disrupt Platform security, infrastructure, or other users</li>
            <li>Share account credentials or allow unauthorized individuals to access the Platform</li>
            <li>Use the Platform to process sensitive financial information, government identification, or information unrelated to clinical care</li>
          </ul>
        </Section>

        <Section title="9. Privacy and Data Processing">
          <P>Your use of the Platform is governed by our <Link href="/privacy" className="text-blue-600 underline">Privacy Policy</Link>, which is incorporated into these Terms by reference. Health Assist AI acts as a service provider (data processor) under BC PIPA and PIPEDA, and as a Business Associate under HIPAA where applicable. Healthcare organizations retain accountability for the personal health information of their patients.</P>
          <P>Patient health information is processed using Microsoft Azure infrastructure. Application infrastructure is hosted in Canada Central. AI and speech processing use Microsoft Azure services in the United States (East US 2). We maintain a Microsoft Data Processing Agreement and HIPAA Business Associate Agreement to ensure comparable protection for cross-border transfers. See <Link href="/privacy" className="text-blue-600 underline">Privacy Policy §14</Link> for full details.</P>
        </Section>

        <Section title="10. Intellectual Property">
          <P>The Platform, including all software, algorithms, models, and output templates, is the exclusive property of Health Assist AI. We grant you a limited, non-exclusive, non-transferable, revocable right to access and use the Platform for your internal lawful clinical purposes in accordance with these Terms. Patient data entered into the Platform remains the property of the patient and the healthcare organization — Health Assist AI claims no ownership over patient PHI.</P>
        </Section>

        <Section title="11. Third-Party Services">
          <P>The Platform integrates with third-party services (including Microsoft Azure) that are governed by their own terms and privacy policies. Health Assist AI is not responsible for the practices of third-party services beyond the contractual obligations we impose on them as sub-processors.</P>
        </Section>

        <Section title="12. Service Availability and Changes">
          <P>We strive to maintain high platform availability but do not guarantee uninterrupted access. We may modify, suspend, or discontinue features of the Platform at any time. We will provide reasonable advance notice of material changes to paid subscribers.</P>
        </Section>

        <Section title="13. Suspension and Termination">
          <P>We may suspend or terminate your access to the Platform immediately if we determine you have violated these Terms, if required by law, or if your use poses a security or legal risk. Upon termination, patient PHI continues to be retained for the remainder of the configured retention window (default: 3 years from session creation), after which it is automatically and permanently deleted. Sections 3, 5, 10, 14, 15, 16, and 17 survive termination.</P>
        </Section>

        <Section title="14. Disclaimer of Warranties">
          <P>THE PLATFORM IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WE DO NOT WARRANT THAT AI-GENERATED OUTPUTS WILL BE ACCURATE, COMPLETE, OR SUITABLE FOR ANY CLINICAL PURPOSE.</P>
        </Section>

        <Section title="15. Limitation of Liability">
          <P>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, HEALTH ASSIST AI&rsquo;S AGGREGATE LIABILITY TO YOU FOR ANY CLAIM ARISING FROM OR RELATED TO THESE TERMS OR YOUR USE OF THE PLATFORM SHALL NOT EXCEED THE GREATER OF: (A) THE FEES YOU PAID TO US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM; OR (B) CAD $100.</P>
          <P>IN NO EVENT SHALL HEALTH ASSIST AI BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR GOODWILL, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. This limitation applies to the fullest extent permitted by applicable law.</P>
        </Section>

        <Section title="16. Indemnification">
          <P>You agree to defend, indemnify, and hold harmless Health Assist AI and its officers, directors, employees, and agents from and against any claims, damages, losses, and expenses (including reasonable legal fees) arising out of or related to: (a) your use of the Platform in violation of these Terms; (b) your clinical or operational use of AI-generated outputs; or (c) your failure to obtain required patient consent or to comply with applicable privacy legislation.</P>
        </Section>

        <Section title="17. Governing Law and Dispute Resolution">
          <P>These Terms are governed by and construed in accordance with the laws of the Province of British Columbia and the federal laws of Canada applicable therein, without regard to conflict of law principles. Any dispute arising from these Terms shall be subject to the exclusive jurisdiction of the courts of British Columbia.</P>
        </Section>

        <Section title="18. Changes to These Terms">
          <P>We may update these Terms from time to time. Updated Terms will be posted at this URL with a revised effective date. Material changes will be communicated to registered users by email or in-platform notice at least 14 days before taking effect. Continued use of the Platform after the effective date constitutes acceptance of the updated Terms.</P>
        </Section>

        <Section title="19. Contact">
          <P>For legal inquiries or questions about these Terms:</P>
          <P><strong>Health Assist AI</strong><br /><a href="mailto:info@health-assist.org" className="text-blue-600 underline">info@health-assist.org</a></P>
        </Section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-12 py-8 text-center text-sm text-gray-500">
        <p>&copy; {new Date().getFullYear()} Health Assist AI. All rights reserved.</p>
        <div className="mt-2 flex justify-center gap-6">
          <Link href="/privacy" className="hover:text-gray-700 underline">Privacy Policy</Link>
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
