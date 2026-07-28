import './PlaceholderPage.css';

interface PlaceholderPageProps {
  eyebrow?: string;
  heading: string;
  body: string;
}

export function PlaceholderPage({ eyebrow, heading, body }: PlaceholderPageProps) {
  return (
    <section className="placeholder-page">
      {eyebrow && <p className="placeholder-page__eyebrow">{eyebrow}</p>}
      <h1 className="placeholder-page__heading">{heading}</h1>
      <p className="placeholder-page__body">{body}</p>
    </section>
  );
}
