import { Link } from 'react-router-dom'

export function LegalFooter() {
  return (
    <footer className="legal-footer" aria-label="Legal and support">
      <nav>
        <Link to="/terms/customer">Terms</Link>
        <Link to="/terms/restaurant">Restaurant terms</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/refunds-and-cancellations">Refunds</Link>
        <Link to="/allergen-information">Allergen information</Link>
        <Link to="/contact">Contact</Link>
      </nav>
    </footer>
  )
}
