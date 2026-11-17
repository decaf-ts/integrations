import { Condition, ModelService, service } from "@decaf-ts/core";
import {
  ERPNextAccount,
  ERPNextChartOfAccountsNode,
} from "../models/ERPNextAccounting.model";

function toNode(account: ERPNextAccount): ERPNextChartOfAccountsNode {
  return new ERPNextChartOfAccountsNode({
    account: account.name,
    account_name: account.account_name,
    parent_account: account.parent_account,
    root_type: account.root_type,
    account_type: account.account_type,
    is_group: account.is_group,
  });
}

/**
 * @description Service for reading and shaping the ERPNext chart of accounts
 * @summary Lists the accounts of a company and builds them into a parent/child tree
 * or a flattened traversal for reporting and pickers.
 * @class ERPNextChartOfAccountsService
 * @category ERPNext
 * @example
 * ```typescript
 * const tree = await service(ERPNextChartOfAccountsService).tree("ACME");
 * ```
 */
@service("ERPNextChartOfAccountsService")
export class ERPNextChartOfAccountsService extends ModelService<ERPNextAccount> {
  constructor() {
    super(ERPNextAccount);
  }

  /**
   * @description Lists the accounts of a company
   * @param {string} company - The ERPNext company
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextAccount[]>} The company accounts
   */
  async listForCompany(
    company: string,
    ...args: any[]
  ): Promise<ERPNextAccount[]> {
    return this.repo
      .select()
      .where(Condition.attr<ERPNextAccount>("company").eq(company))
      .execute(...args);
  }

  /**
   * @description Builds the chart of accounts tree for a company
   * @summary Links each account to its parent and returns the root nodes.
   * @param {string} company - The ERPNext company
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextChartOfAccountsNode[]>} The root nodes
   */
  async tree(
    company: string,
    ...args: any[]
  ): Promise<ERPNextChartOfAccountsNode[]> {
    const accounts = await this.listForCompany(company, ...args);
    const nodes = new Map<string, ERPNextChartOfAccountsNode>();
    for (const account of accounts) nodes.set(account.name, toNode(account));

    const roots: ERPNextChartOfAccountsNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parent_account
        ? nodes.get(node.parent_account)
        : undefined;
      if (parent && parent !== node) {
        parent.children = parent.children ?? [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  /**
   * @description Flattens the chart of accounts tree for a company
   * @summary Depth-first traversal of {@link tree} into a single ordered list.
   * @param {string} company - The ERPNext company
   * @param {...any} args - Optional repository arguments
   * @return {Promise<ERPNextChartOfAccountsNode[]>} The flattened nodes
   */
  async flatten(
    company: string,
    ...args: any[]
  ): Promise<ERPNextChartOfAccountsNode[]> {
    const roots = await this.tree(company, ...args);
    const flattened: ERPNextChartOfAccountsNode[] = [];
    const visit = (node: ERPNextChartOfAccountsNode): void => {
      flattened.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    for (const root of roots) visit(root);
    return flattened;
  }
}
