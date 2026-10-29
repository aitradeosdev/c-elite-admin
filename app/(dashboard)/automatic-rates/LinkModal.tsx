'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Button, Combobox, FieldShell, Modal, Money, Notice, TBody, THead, Table, Td, Th, Tr,
  type ComboboxOption,
} from '../../_ui';
import { currencyAmount } from '../rates/model';
import { formatPct, unpricedReasonText } from './rules';
import { previewBands, sentence, type LinkCard, type LinkRow, type ProviderProduct } from './model';
import s from './page.module.css';

export interface LinkModalProps {
  row: LinkRow;
  card: LinkCard;
  products: readonly ProviderProduct[];
  provider: string;
  onClose: () => void;
  onSubmit: (row: LinkRow, card: LinkCard, product: ProviderProduct) => Promise<boolean>;
}

interface ProductOption extends ComboboxOption {
  product: ProviderProduct;
}

function describe(product: ProviderProduct): string {
  const parts = [product.ref, product.country, product.currency, product.form].filter((part): part is string => part !== null);
  if (product.problem !== null) parts.push('rates not usable');
  if (!product.inLatest) parts.push('not in the latest list');
  return parts.join(' · ');
}

function Preview({ row, card, product, provider }: { row: LinkRow; card: LinkCard; product: ProviderProduct; provider: string }) {
  const bands = previewBands(product, card.effectivePct);
  const symbol = row.path.currency;
  if (product.problem !== null) {
    return (
      <Notice variant="callout" tone="warning" title="Rates not usable">
        {sentence(provider)}’s rates for this product cannot be used because {unpricedReasonText(product.problem)}. If you link it,
        this card type is switched off at each update until they can be used.
      </Notice>
    );
  }
  if (bands === null) return null;
  return (
    <div className={s.preview}>
      {!product.inLatest ? (
        <Notice tone="warning" compact flush>
          This product was not in {provider}’s latest list, so this card type is switched off at the next update unless it is listed again.
        </Notice>
      ) : null}
      <Table density="dense" aria-label={`${product.name} rates`}>
        <THead>
          <Tr>
            <Th>Provider’s range</Th>
            <Th align="right">Provider’s rate</Th>
            <Th align="right">Paid with {formatPct(card.effectivePct)}</Th>
          </Tr>
        </THead>
        <TBody>
          {bands.map((band) => (
            <Tr key={`${band.min}-${band.max}`}>
              <Td className={s.mono}>{`${currencyAmount(symbol, band.min)} – ${currencyAmount(symbol, band.max)}`}</Td>
              <Td align="right"><Money value={band.rateKobo / 100} /></Td>
              <Td align="right">
                {band.valid
                  ? <Money value={band.paidKobo / 100} emphasis="strong" />
                  : <span className={s.failed}>Not a valid rate</span>}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      <p className={s.help}>
        Rates are naira per 1 unit of the card’s currency, after the extra percentage and rounded to the nearest kobo.
      </p>
    </div>
  );
}

export function LinkModal({ row, card, products, provider, onClose, onSubmit }: LinkModalProps) {
  const baseId = useId();
  const formId = `${baseId}-form`;
  const aliveRef = useRef(true);
  const [pick, setPick] = useState<string | null>(row.ref);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const options = useMemo<ProductOption[]>(() => products.map((product) => ({
    value: product.ref,
    label: product.name,
    description: describe(product),
    keywords: [product.ref, product.country, product.currency, product.form].filter((part): part is string => part !== null),
    product,
  })), [products]);
  const picked = options.find((option) => option.value === pick);
  const chosen = picked ? picked.product : null;
  const symbol = row.path.currency;
  const noSymbol = symbol === '';

  const submit = async () => {
    if (submitting) return;
    if (noSymbol) return;
    if (!chosen) {
      setError('Choose the provider product for this card type.');
      return;
    }
    if (chosen.ref === row.ref) {
      setError('This card type is already linked to that product.');
      return;
    }
    setSubmitting(true);
    let done = false;
    try {
      done = await onSubmit(row, card, chosen);
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
    if (done) onClose();
  };

  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  return (
    <Modal
      open
      onClose={onClose}
      static={submitting}
      size="md"
      title={`Link ${row.title}`}
      subtitle={`Choose the product from ${provider} that this card type follows.`}
      footer={(
        <>
          <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={submitting} disabled={noSymbol}>
            Link card type…
          </Button>
        </>
      )}
    >
      <form id={formId} className={s.modalForm} noValidate onSubmit={onFormSubmit}>
        {noSymbol ? (
          <Notice tone="warning" compact flush>
            {row.path.countryName} has no currency symbol, so this card type cannot be linked. Add one in Cards first.
          </Notice>
        ) : null}
        <FieldShell
          label="Provider product"
          required
          error={error}
          help={noSymbol
            ? undefined
            : `Check the country, currency and card type before linking. Rates are paid per 1 unit of this card’s currency (${symbol}).`}
        >
          <Combobox<ProductOption>
            options={options}
            value={pick}
            onChange={(value) => {
              setPick(value);
              setError(null);
            }}
            placeholder="Search by name or code"
            emptyText="No matching product"
            invalid={Boolean(error)}
            readOnly={submitting || noSymbol}
          />
        </FieldShell>
        {chosen && !noSymbol ? <Preview row={row} card={card} product={chosen} provider={provider} /> : null}
      </form>
    </Modal>
  );
}
