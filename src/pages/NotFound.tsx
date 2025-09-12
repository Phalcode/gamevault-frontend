import { AuthLayout } from "@tw/auth-layout";
import { Button } from "@tw/button";

export default function NotFound() {
  return (
    <AuthLayout>
      <div className="flex flex-col items-center">
        <h1 className="text-4xl mb-4">You took a wrong turn there, friend</h1>
        <Button href="/"> Go Back Home </Button>
      </div>
    </AuthLayout>
  );
}
