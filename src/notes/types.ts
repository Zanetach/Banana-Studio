export interface SelectionContext {
  nodeId: string;
  selectedText: string;
  preText: string;
  postText: string;
  fullText: string;
  isExplicit?: boolean;
}
