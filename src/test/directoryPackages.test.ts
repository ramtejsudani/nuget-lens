import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DirectoryPackagesParser } from '../parsers/DirectoryPackagesParser';
import { NuGetConfigParser, extractMsBuildRestoreSources } from '../parsers/NuGetConfigParser';
import { compareVersions, computeUpgradeRecommendation, parseVersion } from '../utils/semver';

const DEV_FEED = 'https://pkgs.dev.azure.com/LSMGDII/5636b32a-9e84-411c-a79c-2ea9b7189b1f/_packaging/internal-nuget-dev/nuget/v3/index.json';

// Central Package Management with a stable/develop channel switch: the same package is declared
// twice under different ItemGroup Conditions, and the dev feed is only added via MSBuild.
const CHANNEL_PROPS = `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <TqsChannel Condition="'$(TqsChannel)' == ''">stable</TqsChannel>
  </PropertyGroup>
  <!-- develop only: ADD the dev feed -->
  <PropertyGroup Condition="'$(TqsChannel)' == 'develop'">
    <RestoreAdditionalProjectSources>${DEV_FEED}</RestoreAdditionalProjectSources>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
  <ItemGroup Condition="'$(TqsChannel)' == 'stable'">
    <PackageVersion Include="TQSDocOps" Version="1.0.33" />
    <PackageVersion Include="TQS-DataHistorianStatistics" Version="2.10.9.593-4518" />
  </ItemGroup>
  <ItemGroup Condition="'$(TqsChannel)' == 'develop'">
    <PackageVersion Include="TQSDocOps" Version="1.0.36-develop" />
    <PackageVersion Include="TQS-DataHistorianStatistics" Version="2.10.9.593-4802-dev" />
  </ItemGroup>
</Project>
`;

suite('Directory.Packages.props with conditional channels', () => {

    test('parses every PackageVersion, including duplicates under different Conditions', () => {
        const packages = new DirectoryPackagesParser().parseDirectoryPackages(CHANNEL_PROPS);
        assert.deepStrictEqual(
            packages.map(p => [p.packageId, p.version, p.lineNumber]),
            [
                ['Newtonsoft.Json', '13.0.3', 10],
                ['TQSDocOps', '1.0.33', 13],
                ['TQS-DataHistorianStatistics', '2.10.9.593-4518', 14],
                ['TQSDocOps', '1.0.36-develop', 17],
                ['TQS-DataHistorianStatistics', '2.10.9.593-4802-dev', 18]
            ]
        );
    });

    test('extracts RestoreAdditionalProjectSources from a conditional PropertyGroup', () => {
        assert.deepStrictEqual(extractMsBuildRestoreSources(CHANNEL_PROPS), [DEV_FEED]);
    });

    test('ignores MSBuild property references and splits ; lists', () => {
        const xml = `<Project><PropertyGroup>
            <RestoreAdditionalProjectSources>$(RestoreAdditionalProjectSources);https://a.example/v3/index.json; https://b.example/v3/index.json</RestoreAdditionalProjectSources>
        </PropertyGroup></Project>`;
        assert.deepStrictEqual(extractMsBuildRestoreSources(xml), ['https://a.example/v3/index.json', 'https://b.example/v3/index.json']);
    });

    test('resolveSources adds the props feed on top of nuget.config', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-lens-'));
        try {
            fs.writeFileSync(path.join(dir, 'NuGet.Config'), `<configuration><packageSources>
                <add key="stable" value="https://stable.example/v3/index.json" />
            </packageSources></configuration>`);
            const propsPath = path.join(dir, 'Directory.Packages.props');
            fs.writeFileSync(propsPath, CHANNEL_PROPS);

            const urls = new NuGetConfigParser().resolveSources(propsPath).map(s => s.url);
            assert.deepStrictEqual(urls, ['https://stable.example/v3/index.json', DEV_FEED]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

suite('NuGet version comparison', () => {

    const cmp = (a: string, b: string) => Math.sign(compareVersions(parseVersion(a)!, parseVersion(b)!));

    test('4th revision segment is significant', () => {
        assert.strictEqual(cmp('2.10.9.600', '2.10.9.593'), 1);
        assert.strictEqual(cmp('2.10.9.593-4518', '2.10.9.600-4518'), -1);
    });

    test('numeric prerelease identifiers compare numerically', () => {
        assert.strictEqual(cmp('1.0.0-develop.10', '1.0.0-develop.9'), 1);
        assert.strictEqual(cmp('2.10.9.593-4802', '2.10.9.593-4518'), 1);
        assert.strictEqual(cmp('1.0.0-Develop', '1.0.0-develop'), 0);
    });

    test('develop line gets a develop upgrade from merged feed versions', () => {
        const versions = ['1.0.33', '1.0.34', '1.0.36-develop', '1.0.37-develop'];
        assert.strictEqual(computeUpgradeRecommendation('1.0.36-develop', versions).latestMajor, '1.0.37-develop');
        // stable line still only sees stable versions unless includePrerelease is on
        assert.strictEqual(computeUpgradeRecommendation('1.0.33', versions).latestMajor, '1.0.34');
    });
});
