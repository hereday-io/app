// Stripe's official wordmark. Path lifted verbatim from Stripe's brand
// asset — never recolor to brand colors per their guidelines. Defaults
// to #635BFF on neutral backgrounds.

interface StripeWordmarkProps {
  className?: string;
  /** Height in px — width auto-scales. Defaults to 14. */
  height?: number;
}

const StripeWordmark = ({ className, height = 14 }: StripeWordmarkProps) => (
  <svg
    viewBox="0 0 60 25"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Stripe"
    role="img"
    className={className}
    style={{ height, width: "auto", color: "#635BFF", display: "inline-block", verticalAlign: "-2px" }}
  >
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a8.33 8.33 0 0 1-4.56 1.1c-4.01 0-6.83-2.5-6.83-7.48 0-4.19 2.39-7.52 6.3-7.52 3.92 0 5.96 3.28 5.96 7.5 0 .4-.04 1.26-.06 1.48zm-5.92-5.62c-1.03 0-2.17.73-2.17 2.58h4.25c0-1.85-1.07-2.58-2.08-2.58zM40.95 20.3c-1.44 0-2.32-.6-2.9-1.04l-.02 4.63-4.12.87V5.57h3.62l.21 1.03c.56-.52 1.58-1.3 3.18-1.3 2.84 0 5.52 2.55 5.52 7.27 0 5.13-2.65 7.74-5.49 7.74zM40 9.27c-.94 0-1.53.34-1.97.81l.02 6.12c.4.44.99.78 1.95.78 1.55 0 2.6-1.69 2.6-3.87 0-2.13-1.04-3.84-2.6-3.84zM28.24 5.57h4.13v14.44h-4.13V5.57zm0-4.7L32.37 0v3.36l-4.13.88V.88zm-4.32 9.35v9.79H19.8V5.57h3.7l.27 1.22c1-1.77 3.07-1.41 3.62-1.22v3.79c-.52-.17-2.29-.43-3.47 1.06zm-8.55 4.72c0 2.43 2.6 1.68 3.12 1.46v3.36c-.55.3-1.54.54-2.89.54a4.15 4.15 0 0 1-4.27-4.24l.01-13.17 4.02-.86v3.54h3.14V9.1h-3.13v5.85zm-4.91.7c0 2.97-2.31 4.66-5.73 4.66a11.2 11.2 0 0 1-4.46-.93v-3.93c1.38.75 3.1 1.31 4.46 1.31.92 0 1.58-.24 1.58-1C6.31 14.51 0 14.79 0 10.16 0 7.24 2.22 5.5 5.55 5.5c1.42 0 2.84.22 4.27.79v3.88a9.4 9.4 0 0 0-4.27-1.1c-.86 0-1.39.25-1.39.9 0 1.69 6.34 1.04 6.34 5.65z"
    />
  </svg>
);

export default StripeWordmark;
