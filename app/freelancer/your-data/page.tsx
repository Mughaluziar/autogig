import { YourData } from "@/components/account/your-data";
import { PageHeader } from "@/components/shared/page-header";

export const metadata = { title: "Your data" };

export default function YourDataPage() {
  return (
    <>
      <PageHeader title="Your data" description="Download everything we hold about you, or delete your account." />
      <YourData />
    </>
  );
}
