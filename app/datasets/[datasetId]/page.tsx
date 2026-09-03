import { notFound } from 'next/navigation';
import { loadDatasetBundle } from '../../../lib/datasets';
import { Badge, Panel, Table, Td, Th } from '../../../components/ui';

export const dynamic = 'force-dynamic';

export default async function DatasetPage({ params }: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await params;

  let bundle;
  try {
    bundle = loadDatasetBundle(datasetId);
  } catch {
    notFound();
  }

  const counts = bundle.dataset.cases.reduce<Record<string, number>>((accumulator, testCase) => {
    accumulator[testCase.category] = (accumulator[testCase.category] ?? 0) + 1;
    return accumulator;
  }, {});

  return (
    <>
      <Panel
        title={bundle.dataset.name}
        description={`${bundle.dataset.cases.length} cases · ${bundle.dataset.knowledgeBase.length} knowledge snippets · content hash ${bundle.hash}`}
      >
        <p className="px-4 py-3 text-sm text-stone-600 dark:text-stone-400">{bundle.dataset.description}</p>
        <div className="flex flex-wrap gap-1.5 border-t border-stone-100 px-4 py-3 dark:border-stone-800">
          {Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([category, count]) => (
              <Badge key={category}>
                {category} · {count}
              </Badge>
            ))}
        </div>
      </Panel>

      <Panel title="Workflow versions">
        <Table
          head={
            <tr>
              <Th>Version</Th>
              <Th>Model</Th>
              <Th>Retrieval</Th>
              <Th>Changelog</Th>
            </tr>
          }
        >
          {bundle.workflows.map((workflow) => (
            <tr key={workflow.version} className="align-top">
              <Td mono>{workflow.version}</Td>
              <Td mono>{workflow.model}</Td>
              <Td mono>
                {workflow.retrieval}
                {workflow.retrieval === 'keyword' ? `/${workflow.retrievalTopK}` : ''}
              </Td>
              <Td>
                <div className="max-w-xl text-xs text-stone-600 dark:text-stone-400">{workflow.changelog}</div>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Cases" description="The reference answers and assertions every run is scored against.">
        <Table
          head={
            <tr>
              <Th>Case</Th>
              <Th>Input</Th>
              <Th>Expected</Th>
              <Th>Assertions</Th>
            </tr>
          }
        >
          {bundle.dataset.cases.map((testCase) => (
            <tr key={testCase.id} className="align-top hover:bg-stone-50 dark:hover:bg-stone-800/50">
              <Td mono>
                {testCase.id}
                <div className="mt-1 text-stone-500">{testCase.category}</div>
                {testCase.weight !== 1 ? <div className="mt-1 text-stone-400">weight {testCase.weight}</div> : null}
              </Td>
              <Td>
                <div className="max-w-xs">{testCase.input}</div>
              </Td>
              <Td>
                <div className="max-w-sm text-stone-600 dark:text-stone-400">{testCase.expected}</div>
              </Td>
              <Td>
                <div className="flex max-w-xs flex-wrap gap-1">
                  {testCase.shouldRefuse ? <Badge tone="warn">must decline</Badge> : null}
                  {testCase.mustInclude.map((phrase) => (
                    <Badge key={phrase} tone="pass">
                      must include: {phrase}
                    </Badge>
                  ))}
                  {testCase.mustNotInclude.map((phrase) => (
                    <Badge key={phrase} tone="fail">
                      must not: {phrase}
                    </Badge>
                  ))}
                  {testCase.keyPoints.map((point) => (
                    <Badge key={point} tone="info">
                      {point}
                    </Badge>
                  ))}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
