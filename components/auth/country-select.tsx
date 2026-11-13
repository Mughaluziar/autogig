import { Select } from "@/components/ui/select";
import { COUNTRIES, DEFAULT_COUNTRY, POPULAR_COUNTRIES } from "@/lib/countries";

/** Country / region dropdown, United States by default. */
export function CountrySelect({ id = "country", defaultValue = DEFAULT_COUNTRY }: { id?: string; defaultValue?: string }) {
  return (
    <Select id={id} name={id} defaultValue={defaultValue} autoComplete="country-name" required>
      <optgroup label="Popular">
        {POPULAR_COUNTRIES.map((c) => (
          <option key={`p-${c}`} value={c}>{c}</option>
        ))}
      </optgroup>
      <optgroup label="All countries and regions">
        {COUNTRIES.filter((c) => !POPULAR_COUNTRIES.includes(c)).map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </optgroup>
    </Select>
  );
}
