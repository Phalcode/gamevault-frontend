import { Heading } from "@tw/heading";
import {
  Pagination,
  PaginationGap,
  PaginationList,
  PaginationNext,
  PaginationPage,
  PaginationPrevious,
} from "@tw/pagination";
import { Divider } from "../components/tailwind/divider";

export default function Library() {
  return (
    <div className="flex flex-col h-full">
      <Heading>Library</Heading>
      <Divider />
      <div className="flex-grow">
        <h1>Library is Coming Soon...</h1>
      </div>
      <Pagination>
        <PaginationPrevious href="?page=2" />
        <PaginationList>
          <PaginationPage href="?page=1" current>
            1
          </PaginationPage>
          <PaginationPage href="?page=2">2</PaginationPage>
          <PaginationPage href="?page=3">3</PaginationPage>
          <PaginationGap />
          <PaginationPage href="?page=66">23</PaginationPage>
        </PaginationList>
        <PaginationNext href="?page=4" />
      </Pagination>
    </div>
  );
}
