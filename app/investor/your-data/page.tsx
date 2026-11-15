import { ProfileForm } from "@/components/account/profile-form";
import { YourData } from "@/components/account/your-data";
import { PageHeader } from "@/components/shared/page-header";

export const metadata = { title: "Your data" };

export default function YourDataPage() {
  return (
    <>
      <PageHeader title="Account and data" description="Correct your name, change your sign-in email, download everything we hold about you, or delete your account." />
      <div className="space-y-6">
        <ProfileForm />
        <YourData />
      </div>
    </>
  );
}
