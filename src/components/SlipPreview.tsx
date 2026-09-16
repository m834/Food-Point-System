'use client';

import { useState } from 'react';
import { imageUrl } from '@/lib/api';
import { strings } from '@/lib/strings';

/**
 * What the top of a printed slip will look like.
 *
 * Rendered at roughly the proportions of an 80mm roll in a monospace face, so
 * the owner can judge whether their logo and shop name actually fit before a
 * customer is handed one. It updates as the fields above it are typed, which
 * is the whole point: the alternative is printing a test slip per edit.
 *
 * Two honest limits, stated in the UI rather than hidden:
 *  - The logo is NOT yet printed on the thermal slip; that is staged behind
 *    `electron/services/receiptLogo.ts` until it can be trialled on the
 *    client's real printer. This preview shows the intended layout.
 *  - The printer's own font differs slightly from any screen font, so line
 *    wrapping on paper can land a character or two apart.
 */
export function SlipPreview({
  logoFile,
  name,
  address,
  phone,
  footer,
}: {
  logoFile: string | null;
  name: string;
  address: string;
  phone: string;
  footer: string;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  // A filename with no file behind it must fall back to the name alone, never
  // a broken-image box on the owner's own receipt.
  const showLogo = Boolean(logoFile) && !logoFailed;

  return (
    <div className="slip-preview-wrap">
      <div className="slip-preview" aria-label={strings.settings.slipPreview}>
        {showLogo ? (
          <img
            className="slip-preview-logo"
            src={imageUrl('logo', logoFile!)}
            alt=""
            onError={() => setLogoFailed(true)}
          />
        ) : null}

        <div className="slip-preview-rule">{'='.repeat(42)}</div>
        <div className="slip-preview-name">{name || 'Food Point'}</div>
        {address ? <div className="slip-preview-line">{address}</div> : null}
        {phone ? <div className="slip-preview-line">{phone}</div> : null}
        <div className="slip-preview-rule">{'='.repeat(42)}</div>

        <div className="slip-preview-body">
          <div className="slip-preview-row">
            <span>Order 20260822-014</span>
            <span>Dine-in · T3</span>
          </div>
          <div className="slip-preview-rule">{'-'.repeat(42)}</div>
          {/* The four columns the printed bill uses: what it was, what ONE
              costs, how many, and what they come to. */}
          <div className="slip-preview-items">
            <span>Item</span>
            <span>Price</span>
            <span>Qty</span>
            <span>Amount</span>
          </div>
          <div className="slip-preview-rule">{'-'.repeat(42)}</div>
          <div className="slip-preview-items">
            <span>Chicken Tikka (Large)</span>
            <span>1499.00</span>
            <span>1</span>
            <span>1499.00</span>
          </div>
          <div className="slip-preview-items">
            <span>Zinger Burger</span>
            <span>350.00</span>
            <span>2</span>
            <span>700.00</span>
          </div>
          <div className="slip-preview-rule">{'='.repeat(42)}</div>
          <div className="slip-preview-row slip-preview-total">
            <span>TOTAL</span>
            <span>Rs.2199.00</span>
          </div>
          <div className="slip-preview-line" style={{ marginTop: 10 }}>
            Thank you — please come again
          </div>
          {footer ? <div className="slip-preview-line">{footer}</div> : null}
        </div>
      </div>

      <p className="tiny muted slip-preview-note">{strings.settings.slipPreviewNote}</p>
    </div>
  );
}
