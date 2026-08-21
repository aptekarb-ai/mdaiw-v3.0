import './CreateEmailStepper.css';

const STEP_LABELS = ['Setup', 'Choose Template', 'Configure', 'Start Building'];

interface CreateEmailStepperProps {
  currentStep: number;
}

// Feature 02 only implements step 1 (Setup) — steps 2-4 are shown so the
// intended wizard shape is visible, matching the reference PNG, but stay
// permanently upcoming; there is no completed state to render yet.
export function CreateEmailStepper({ currentStep }: CreateEmailStepperProps) {
  return (
    <ol className="create-email-stepper" aria-label="Create email progress">
      {STEP_LABELS.map((label, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === currentStep;

        return (
          <li
            key={label}
            className={
              isActive ? 'create-email-stepper__item create-email-stepper__item--active' : 'create-email-stepper__item'
            }
            aria-current={isActive ? 'step' : undefined}
          >
            <span className="create-email-stepper__circle" aria-hidden="true">
              {stepNumber}
            </span>
            <span className="create-email-stepper__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
