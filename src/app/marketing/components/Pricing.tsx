"use client";

export default function Pricing() {
  const plans = [
    {
      name: "Starter",
      price: "$99",
      period: "per month",
      description: "Perfect for individual physicians",
      features: [
        "Up to 100 patient intakes/month",
        "AI-powered history taking",
        "Basic customization",
        "Email support",
        "HIPAA compliance included",
      ],
      cta: "Get Started",
      popular: false,
    },
    {
      name: "Professional",
      price: "$299",
      period: "per month",
      description: "Ideal for small clinics",
      features: [
        "Up to 500 patient intakes/month",
        "Advanced AI features",
        "Full customization options",
        "Priority support",
        "HIPAA compliance included",
        "Custom workflows",
        "Analytics dashboard",
      ],
      cta: "Get Started",
      popular: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      period: "pricing",
      description: "For large organizations",
      features: [
        "Unlimited patient intakes",
        "All AI features",
        "White-label options",
        "Dedicated support",
        "HIPAA compliance included",
        "Custom integrations",
        "Advanced analytics",
        "SLA guarantee",
      ],
      cta: "Contact Sales",
      popular: false,
    },
  ];

  return (
    <section id="pricing" className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Choose the plan that fits your practice. All plans include 
            HIPAA compliance and patient confidentiality protection.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((plan, index) => (
            <div
              key={index}
              className={`relative bg-white rounded-2xl shadow-lg p-8 ${
                plan.popular
                  ? "ring-2 ring-cyan-500 transform scale-105"
                  : ""
              }`}
            >
              {plan.popular && (
                <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                  <span className="bg-gradient-to-r from-cyan-500 to-teal-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  {plan.name}
                </h3>
                <p className="text-gray-600 mb-4">{plan.description}</p>
                <div className="mb-4">
                  <span className="text-5xl font-bold text-gray-900">
                    {plan.price}
                  </span>
                  {plan.period !== "pricing" && (
                    <span className="text-gray-600 ml-2">
                      {plan.period}
                    </span>
                  )}
                </div>
              </div>

              <ul className="space-y-4 mb-8">
                {plan.features.map((feature, featureIndex) => (
                  <li key={featureIndex} className="flex items-start">
                    <svg
                      className="w-6 h-6 text-cyan-500 mr-3 flex-shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span className="text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                className={`w-full py-3 px-6 rounded-full font-semibold transition-all ${
                  plan.popular
                    ? "bg-gradient-to-r from-cyan-500 to-teal-500 text-white hover:shadow-lg"
                    : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                }`}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-gray-600 mb-4">
            All plans include a 14-day free trial. No credit card required.
          </p>
          <p className="text-sm text-gray-500">
            Need help choosing?{" "}
            <a href="#cta" className="text-cyan-600 hover:text-cyan-700 font-medium">
              Contact our team
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

























