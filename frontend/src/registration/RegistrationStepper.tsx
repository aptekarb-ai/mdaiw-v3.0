import './RegistrationStepper.css';

const STEP_LABELS = ['Account Details', 'Employee Details', 'Face Enrollment', 'Review and Submit'];

interface RegistrationStepperProps {
  currentStep: number;
}

export function RegistrationStepper({ currentStep }: RegistrationStepperProps) {
  return (
    <ol className="registration-stepper" aria-label="Registration progress">
      {STEP_LABELS.map((label, index) => {
        const stepNumber = index + 1;
        const isCompleted = stepNumber < currentStep;
        const isActive = stepNumber === currentStep;
        const stateClass = isCompleted
          ? 'registration-stepper__item--completed'
          : isActive
            ? 'registration-stepper__item--active'
            : '';

        return (
          <li
            key={label}
            className={`registration-stepper__item ${stateClass}`}
            aria-current={isActive ? 'step' : undefined}
          >
            <span className="registration-stepper__circle" aria-hidden="true">
              {isCompleted ? (
                <span className="mdaiw-icon mdaiw-icon--check" aria-hidden="true" />
              ) : (
                stepNumber
              )}
            </span>
            <span className="registration-stepper__label">{label}</span>
            {stepNumber < STEP_LABELS.length && (
              <span className="registration-stepper__connector" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
