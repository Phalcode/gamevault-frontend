import { AuthLayout } from "@tw/auth-layout";
import { Button } from "@tw/button";

export default function NotFound() {
  return (
    <AuthLayout>
      <div className="flex flex-col items-center">
        <img src="/dead-end.svg" alt="Dead End Roadsign" className="mb-4 h-40" />
        <h1 className="text-4xl mb-4">I think you took a wrong turn there, mate</h1>
        <Button href="/"> Go Back Home </Button>
      </div>
    </AuthLayout>
  );
}
