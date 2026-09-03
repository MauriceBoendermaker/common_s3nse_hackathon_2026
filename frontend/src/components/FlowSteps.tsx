import { Check } from "lucide-react";

type FlowStep = {
  label: string;
  description: string;
};

type FlowStepsProps = {
  steps: readonly FlowStep[];
  currentStep: number;
};

export function FlowSteps({ steps, currentStep }: FlowStepsProps) {
  return (
    <ol className="flow-steps" aria-label="Workflow progress">
      {steps.map((step, index) => {
        const completed = index < currentStep;
        const active = index === currentStep;

        return (
          <li
            key={step.label}
            className={active ? "is-active" : completed ? "is-complete" : undefined}
            aria-current={active ? "step" : undefined}
          >
            <span className="flow-step__marker" aria-hidden="true">
              {completed ? <Check size={13} /> : index + 1}
            </span>
            <span>
              <strong>{step.label}</strong>
              <small>{step.description}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
